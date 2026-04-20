// ─── Debug da captura via Playwright (engenharia reversa do ML) ────────
//
// Permite ao admin inspecionar todos os XHR responses interceptados pelo
// scraper FULL, identificar QUAL endpoint interno do ML retorna a
// estrutura de cards/sub-status, e usar isso pra implementar a Fase 2
// (frontend consome dados live).
//
// Endpoints:
//   GET /api/ml/admin/live-cards-debug                JSON resumido
//   GET /api/ml/admin/live-cards-debug?format=html    HTML navegavel
//   GET /api/ml/admin/live-cards-debug?run=1          Forca novo scrape
//   GET /api/ml/admin/live-cards-debug?tab=today      Filtra 1 tab
//   GET /api/ml/admin/live-cards-debug?store=outros   Filtra 1 store

import { requireAdmin } from "../../_lib/auth-server.js";
import {
  scrapeMlSellerCenterFull,
  getCachedFullResult,
  isScraperConfigured,
  getLastScraperError,
} from "../_lib/seller-center-scraper.js";

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report, options) {
  const tabsHtml = Object.entries(report.tabs || {})
    .filter(([tabKey]) => !options.tab || tabKey === options.tab)
    .map(([tabKey, stores]) => {
      const storesHtml = Object.entries(stores)
        .filter(([storeKey]) => !options.store || storeKey === options.store)
        .map(([storeKey, capture]) => {
          if (capture.error) {
            return `<details>
              <summary><strong>${escapeHtml(storeKey)}</strong> — ⚠ erro</summary>
              <pre>${escapeHtml(capture.error)}</pre>
            </details>`;
          }
          const xhrs = (capture.xhr_responses || [])
            .map(
              (x, i) => `<details>
              <summary>XHR #${i + 1} — <code>${escapeHtml(x.url.slice(0, 120))}</code> (${x.size} bytes, status ${x.status})</summary>
              <pre>${escapeHtml(JSON.stringify(x.body, null, 2).slice(0, 30000))}</pre>
            </details>`
            )
            .join("");

          // ── SSR payloads (dados embeded no HTML inicial) ──
          const ssrPayloads = capture.ssrPayloads || [];
          const ssrHtml = ssrPayloads.length > 0
            ? `<div style="background:#fff8e1;border:1px solid #fde68a;padding:10px;border-radius:6px;margin:10px 0">
                 <strong>📦 SSR Payloads (dados embeded no HTML — provavel fonte real dos cards):</strong>
                 ${ssrPayloads.map((p, i) => `
                   <details>
                     <summary>SSR #${i + 1} — <code>${escapeHtml(p.source)}</code> (${p.size} bytes)</summary>
                     <pre>${escapeHtml(JSON.stringify(p.body || p.content, null, 2).slice(0, 80000))}</pre>
                   </details>
                 `).join("")}
               </div>`
            : "";

          // ── HTML keywords found (palavras-chave de cards no HTML) ──
          const htmlMatches = capture.htmlMatches || {};
          const matchKeys = Object.keys(htmlMatches);
          const htmlMatchesHtml = matchKeys.length > 0
            ? `<div style="background:#dcfce7;border:1px solid #86efac;padding:10px;border-radius:6px;margin:10px 0">
                 <strong>🔎 HTML Matches (palavras-chave dos cards encontradas no HTML):</strong>
                 ${matchKeys.map((kw) => `
                   <details>
                     <summary>"${escapeHtml(kw)}" encontrado</summary>
                     <pre>${escapeHtml(htmlMatches[kw])}</pre>
                   </details>
                 `).join("")}
               </div>`
            : "";

          // HTML snippet (pra debug visual)
          const htmlSnippetHtml = capture.htmlSnippet
            ? `<details>
                 <summary>📄 HTML snippet (primeiros 50KB)</summary>
                 <pre>${escapeHtml(capture.htmlSnippet.slice(0, 30000))}</pre>
               </details>`
            : "";
          const chipsText = capture.dom_chips_text
            ? `<p class="meta">DOM chips: ${escapeHtml(JSON.stringify(capture.dom_chips_text))}</p>`
            : "";
          const stats = capture.capture_stats;
          const statsHtml = stats
            ? `<p class="meta">📊 Stats: ${stats.total_seen} responses totais · ${stats.blacklisted} blacklisted · ${stats.non_json} non-JSON · <strong>${stats.captured} XHRs capturados</strong>${stats.ssr_payloads_found != null ? ` · <strong>${stats.ssr_payloads_found} SSR payloads</strong>` : ""}</p>`
            : "";
          const navErrHtml = capture.nav_error
            ? `<p class="meta" style="color:#b91c1c">⚠ Nav error: ${escapeHtml(capture.nav_error)}</p>`
            : "";
          return `<details open>
            <summary>
              <strong>${escapeHtml(storeKey)}</strong>
              <code class="url">${escapeHtml((capture.url || "").slice(0, 100))}</code>
              <span class="badge">${capture.xhr_count} XHR</span>
              ${ssrPayloads.length > 0 ? `<span class="badge" style="background:#fbbf24">${ssrPayloads.length} SSR</span>` : ""}
              ${matchKeys.length > 0 ? `<span class="badge" style="background:#22c55e">${matchKeys.length} matches</span>` : ""}
            </summary>
            ${statsHtml}
            ${chipsText}
            ${navErrHtml}
            ${htmlMatchesHtml}
            ${ssrHtml}
            ${xhrs || `<p class="empty">Nenhum XHR JSON capturado nesta navegação.</p>`}
            ${htmlSnippetHtml}
          </details>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(tabKey.toUpperCase())}</h2>${storesHtml}</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Debug — Live Cards (engenharia reversa ML)</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#f5f5f7;color:#1a1a1a;padding:24px;max-width:1280px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:24px 0 12px;padding:8px 12px;background:#333;color:#fff;border-radius:6px}
  .meta{color:#666;font-size:13px;margin-bottom:16px}
  .filters{margin-bottom:20px;padding:12px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;font-size:13px}
  .filters a{color:#3483fa;text-decoration:none;margin-right:12px;padding:4px 8px;border-radius:4px}
  .filters a:hover{background:#eef4ff}
  .filters a.active{background:#fff159;color:#333;font-weight:600}
  details{background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:8px 12px;margin:8px 0;font-size:13px}
  details > details{margin-left:16px;background:#fafbfc;font-size:12px}
  details summary{cursor:pointer;color:#1a1a1a;padding:4px 0}
  details > summary > strong{color:#3483fa}
  pre{background:#f9f9fb;padding:8px;border-radius:4px;overflow-x:auto;font-size:11px;line-height:1.4;max-height:400px;overflow-y:auto}
  code{background:#f0f0f5;padding:1px 5px;border-radius:3px;font-size:11px}
  code.url{color:#666;font-size:10px;margin-left:8px;font-weight:normal}
  .badge{display:inline-block;background:#3483fa;color:#fff;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:bold;margin-left:8px}
  .empty{color:#999;font-style:italic;padding:8px;font-size:11px}
  .run-btn{display:inline-block;background:#3483fa;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px}
  .run-btn:hover{background:#2968c8}
  .stale{background:#fff8e1;border:1px solid #fde68a;padding:8px 12px;border-radius:6px;font-size:13px;color:#92400e;margin-bottom:12px}
</style>
</head>
<body>
  <h1>🔬 Debug — Live Cards (engenharia reversa ML)</h1>
  <div class="meta">
    Capturado em ${escapeHtml(new Date(report.capturedAt).toLocaleString("pt-BR"))}
    · stores: <strong>${escapeHtml((report.stores_scraped || []).join(", "))}</strong>
    ${options.fromCache ? '· <em>(do cache)</em>' : '· <em>(scrape fresh)</em>'}
  </div>

  ${options.stale ? '<div class="stale">⚠ Cache expirado. Clique em "Scrape novo" pra atualizar.</div>' : ""}

  <div class="filters">
    <a href="?format=html&run=1" class="run-btn">↻ Scrape novo (demora ~30-60s)</a>
    &nbsp;&nbsp;
    <strong>Tab:</strong>
    <a href="?format=html" class="${!options.tab ? "active" : ""}">Todas</a>
    <a href="?format=html&tab=today" class="${options.tab === "today" ? "active" : ""}">Hoje</a>
    <a href="?format=html&tab=upcoming" class="${options.tab === "upcoming" ? "active" : ""}">Próximos</a>
    <a href="?format=html&tab=in_transit" class="${options.tab === "in_transit" ? "active" : ""}">Trânsito</a>
    <a href="?format=html&tab=finalized" class="${options.tab === "finalized" ? "active" : ""}">Finalizadas</a>
    &nbsp;&nbsp;
    <strong>Store:</strong>
    <a href="?format=html" class="${!options.store ? "active" : ""}">Todas</a>
    <a href="?format=html&store=outros" class="${options.store === "outros" ? "active" : ""}">Outros</a>
    <a href="?format=html&store=full" class="${options.store === "full" ? "active" : ""}">Full</a>
  </div>

  ${tabsHtml || '<p class="empty">Nenhum dado capturado ainda. Clique em "Scrape novo".</p>'}

  <p style="margin-top:32px;color:#888;font-size:11px">
    Cada XHR JSON foi capturado interceptando responses do browser.
    Procure pelo XHR que contem a estrutura de cards/sub-status do ML.
    Quando identificar qual e, me passe o nome (ex: "XHR #2 do upcoming/outros") e
    eu mapeio o JSON pra estrutura do app na Fase 2.
  </p>
</body>
</html>`;
}

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Acesso negado." });
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ success: false, error: "Use GET." });
  }

  if (!isScraperConfigured()) {
    return response.status(409).json({
      success: false,
      error:
        "Scraper nao configurado. Rode `npm run setup:ml-scraper` localmente, faca login, e copie o storage state pra VPS em $DATA_DIR/playwright/ml-seller-center-state.json.",
      last_error: getLastScraperError(),
    });
  }

  const forceRun = request.query?.run === "1" || request.query?.run === "true";
  const tab = request.query?.tab ? String(request.query.tab) : null;
  const store = request.query?.store ? String(request.query.store) : null;
  const format = String(request.query?.format || "json").toLowerCase();

  let report;
  let fromCache = true;
  let stale = false;

  if (forceRun) {
    fromCache = false;
    // Single mode — passa tab e store especificos pra so 1 navegacao
    // (rapido, ~10-15s vs 60-90s do scrape completo)
    const singleTab = request.query?.tab ? String(request.query.tab) : null;
    const singleStore = request.query?.store ? String(request.query.store) : null;
    const result = await scrapeMlSellerCenterFull({
      timeoutMs: 60_000, // 60s — networkidle pode demorar mais que domcontentloaded
      singleTab,
      singleStore,
    });
    if (!result.ok) {
      if (format === "html") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        return response.status(500).send(`<!doctype html><html><body><h1>Erro</h1><pre>${result.error}: ${result.message || ""}</pre><p><a href="?format=html">Voltar</a></p></body></html>`);
      }
      return response.status(502).json({ success: false, ...result });
    }
    report = result;
  } else {
    const cached = getCachedFullResult();
    if (!cached) {
      if (format === "html") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        return response.status(200).send(`<!doctype html><html><body style="font-family:system-ui;padding:24px"><h1>Sem cache ainda</h1><p>Clique pra rodar o scraper pela primeira vez (demora 30-60s):</p><p><a href="?format=html&run=1" style="display:inline-block;background:#3483fa;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">↻ Scrape agora</a></p></body></html>`);
      }
      return response.status(200).json({
        success: true,
        from_cache: false,
        message: "Sem cache. Use ?run=1 pra forcar scrape.",
      });
    }
    report = cached.data;
    stale = cached.stale === true;
  }

  if (format === "html") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(
      renderHtml(report, { tab, store, fromCache, stale })
    );
  }

  return response.status(200).json({
    success: true,
    from_cache: fromCache,
    stale,
    ...report,
  });
}
