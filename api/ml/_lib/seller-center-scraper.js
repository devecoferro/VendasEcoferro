// ═══════════════════════════════════════════════════════════════════
// Seller Center Scraper — Playwright headless
//
// Captura os chips da UI do Mercado Livre Seller Center diretamente via
// DOM scraping, pois a API pública do ML não expõe os mesmos números
// que a UI mostra (agregações internas que misturam orders, shipments,
// post-sale e reputação).
//
// Fluxo:
// 1. Setup manual (1x): admin loga no ML via script dedicated e salva
//    storage state (cookies/localStorage) em arquivo.
// 2. Cron em produção: a cada N min, playwright headless carrega o state,
//    navega pra https://www.mercadolivre.com.br/vendas/omni/lista,
//    extrai os chips do DOM, retorna objeto { today, upcoming, in_transit,
//    finalized }.
// 3. Resultado é cacheado em memória por ~5min e exposto em
//    buildDashboardPayload como ml_ui_chip_counts.
// 4. Se a sessão expirar (redirect pra login ou DOM não bate), retorna
//    { error: "session_expired" } e admin é alertado via log.
//
// ⚠️ SEGURANÇA:
// - Storage state é ARMAZENADO em disco NO DATA_DIR (volume persistente)
// - NUNCA vai pro git (.gitignore exclui data/)
// - Rotacionado se for detectada sessão inválida
//
// ⚠️ RISCO:
// - ML pode detectar padrão de scraping e bloquear a conta.
// - Mitigar: intervalo de 5min min, user-agent real, comportamento humano-like
//   (waits, scroll). Não fazer scraping demais.
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import createLogger from "../../_lib/logger.js";
import { DATA_DIR } from "../../_lib/app-config.js";

const log = createLogger("ml-scraper");

// Defaults e configs
const ML_VENDAS_URL = "https://www.mercadolivre.com.br/vendas/omni/lista";
const DEFAULT_STORAGE_STATE_PATH = path.join(
  DATA_DIR,
  "playwright",
  "ml-seller-center-state.json"
);
const SCRAPER_STORAGE_STATE_PATH =
  process.env.ML_SCRAPER_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE_PATH;
const SCRAPER_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
// TTL do snapshot fica menor (2min) pra sensação de "ao vivo".
// Auto-refresh em background dispara quando cache expira e alguem chama
// o endpoint — ver maybeRefreshLiveSnapshotInBackground().
const LIVE_SNAPSHOT_REFRESH_THRESHOLD_MS = 2 * 60 * 1000;

// Cache em memória do último scrape bem-sucedido
let cachedResult = null; // { data, expiresAt, capturedAt }
let lastError = null; // { error, timestamp }

// Cache em memória do scrape FULL (engenharia reversa via XHR interception)
// Estrutura: { tabs: { [tabKey]: { [storeKey]: { url, xhrJsonResponses: [], domSnapshot } } }, capturedAt, expiresAt }
let cachedFullResult = null;

// ─── Configuracao das combinacoes (tab × store) que serao scraped ───
// Tabs do ML Seller Center (filters URL param)
const ML_TABS = [
  { key: "today", filter: "TAB_TODAY", label: "Envios de hoje" },
  { key: "upcoming", filter: "TAB_NEXT_DAYS", label: "Próximos dias" },
  { key: "in_transit", filter: "TAB_IN_THE_WAY", label: "Em trânsito" },
  { key: "finalized", filter: "TAB_FINISHED", label: "Finalizadas" },
];

// Stores conhecidas (configuravel via env ML_SCRAPER_STORES)
// Default: pega "outros" (sem store param) e "full" (logistic_type fulfillment)
const ML_STORES = (process.env.ML_SCRAPER_STORES || "all,outros,full")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Mapeia store key → URL store param que o ML usa
function storeToUrlParam(store) {
  if (store === "all") return ""; // Todas as vendas
  if (store === "outros") return ""; // Vendas sem deposito (usa mesma URL)
  if (store === "full") return "full";
  return store; // Pode ser ID numerico (ex: 79856028 = Ourinhos)
}

/**
 * Verifica se o storage state está disponível no disco.
 */
export function isScraperConfigured() {
  try {
    return fs.existsSync(SCRAPER_STORAGE_STATE_PATH) &&
      fs.statSync(SCRAPER_STORAGE_STATE_PATH).size > 0;
  } catch {
    return false;
  }
}

export function getScraperStorageStatePath() {
  return SCRAPER_STORAGE_STATE_PATH;
}

export function getLastScraperError() {
  return lastError;
}

export function getCachedScraperResult() {
  if (!cachedResult) return null;
  if (cachedResult.expiresAt <= Date.now()) {
    return { ...cachedResult, stale: true };
  }
  return cachedResult;
}

/**
 * Carrega o storage state do disco. Retorna null se não existe ou inválido.
 */
function loadStorageState() {
  try {
    if (!fs.existsSync(SCRAPER_STORAGE_STATE_PATH)) return null;
    const raw = fs.readFileSync(SCRAPER_STORAGE_STATE_PATH, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Sanity check: storage state tem cookies e/ou origins
    if (!parsed || (!parsed.cookies && !parsed.origins)) return null;
    return parsed;
  } catch (err) {
    log.warn("Falha ao ler storage state", err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/**
 * Lazy-load do playwright — só importa quando realmente for scraping.
 * Evita carregar playwright na inicialização do servidor quando não é
 * necessário.
 */
async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    return mod.chromium || mod.default?.chromium;
  } catch (err) {
    log.error(
      "playwright não está instalado no ambiente",
      err instanceof Error ? err : new Error(String(err))
    );
    return null;
  }
}

/**
 * Extrai os 4 chips do DOM da página de vendas.
 * Retorna { today, upcoming, in_transit, finalized } ou null se não bater.
 */
async function extractChipsFromPage(page) {
  // Espera pelo container dos chips (seletor genérico)
  try {
    await page.waitForSelector('[role="tablist"], [data-testid*="tab"], nav', {
      timeout: 15000,
    });
  } catch {
    // se não bateu nos seletores comuns, segue e tenta extrair mesmo assim
  }

  // Pequena espera pra garantir hydration
  await page.waitForTimeout(2000);

  // Tenta extrair via texto dos chips — mais robusto que seletor fixo
  const chips = await page.evaluate(() => {
    const labels = ["Envios de hoje", "Próximos dias", "Em trânsito", "Finalizadas"];
    const result = {};

    // Estratégia 1: busca elementos que contenham os labels + número
    const allElements = document.querySelectorAll("button, div, a, span, li");
    for (const label of labels) {
      for (const el of allElements) {
        const text = (el.textContent || "").trim();
        // Procura padrão "Envios de hoje 75" ou "Envios de hoje\n75" etc.
        if (text.startsWith(label) && text.length < label.length + 15) {
          // Extrai número depois do label
          const match = text.match(new RegExp(`${label}[\\s\\n]*(\\d+)`));
          if (match) {
            result[label] = parseInt(match[1], 10);
            break;
          }
        }
      }
    }
    return result;
  });

  // Valida que pelo menos 3 dos 4 chips foram encontrados
  const foundKeys = Object.keys(chips || {});
  if (foundKeys.length < 3) {
    return null;
  }

  return {
    today: Number(chips["Envios de hoje"] || 0),
    upcoming: Number(chips["Próximos dias"] || 0),
    in_transit: Number(chips["Em trânsito"] || 0),
    finalized: Number(chips["Finalizadas"] || 0),
  };
}

/**
 * Executa o scraper completo: abre browser headless, carrega storage state,
 * navega, extrai chips, retorna resultado.
 *
 * Retorna:
 *   { ok: true, counts: {...}, capturedAt: ISO }
 *   { ok: false, error: "no_state"|"playwright_missing"|"session_expired"|"dom_mismatch"|"network" }
 */
export async function scrapeMlSellerCenter({ timeoutMs = 45_000 } = {}) {
  if (!isScraperConfigured()) {
    const err = { error: "no_state", message: "Storage state não configurado. Execute script de setup inicial." };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    const err = { error: "playwright_missing", message: "Playwright não instalado no container" };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  const storageState = loadStorageState();
  if (!storageState) {
    const err = { error: "no_state", message: "Storage state inválido" };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const context = await browser.newContext({
      storageState,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    const page = await context.newPage();

    // Timeout global da operação
    const navPromise = page.goto(ML_VENDAS_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await navPromise;

    // Detecta redirect pra login
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/auth") ||
      currentUrl.includes("/authorization")
    ) {
      const err = {
        error: "session_expired",
        message: "Session expirada — admin precisa re-login.",
        redirected_to: currentUrl,
      };
      lastError = { ...err, timestamp: new Date().toISOString() };
      log.warn("Scraper redirecionou para login — session expirada");
      return { ok: false, ...err };
    }

    const counts = await extractChipsFromPage(page);
    if (!counts) {
      const err = {
        error: "dom_mismatch",
        message: "Não foi possível extrair os chips do DOM (ML pode ter mudado estrutura)",
      };
      lastError = { ...err, timestamp: new Date().toISOString() };
      return { ok: false, ...err };
    }

    const result = {
      ok: true,
      counts,
      capturedAt: new Date().toISOString(),
    };

    // Atualiza cache
    cachedResult = {
      data: counts,
      capturedAt: result.capturedAt,
      expiresAt: Date.now() + SCRAPER_CACHE_TTL_MS,
    };
    lastError = null;

    return result;
  } catch (err) {
    const errorInfo = {
      error: "network",
      message: err instanceof Error ? err.message : String(err),
    };
    lastError = { ...errorInfo, timestamp: new Date().toISOString() };
    log.error("Scraper falhou", err instanceof Error ? err : new Error(String(err)));
    return { ok: false, ...errorInfo };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENGENHARIA REVERSA — Captura estrutura completa do ML Seller Center
// ═══════════════════════════════════════════════════════════════════
// Em vez de DOM scraping superficial (so chips), navega em cada
// combinacao tab × store e INTERCEPTA as XHRs internas do ML que
// retornam JSON com a estrutura completa de cards + sub-status +
// order_ids. Resultado: classificacao 1:1 com o ML sem chute.
//
// Salvamos TODOS os JSON responses interceptados em
// `xhrJsonResponses` por (tab, store), pra que o operador valide
// no endpoint debug e a gente identifique qual contem os dados certos.

/**
 * Padroes pra IGNORAR (assets, telemetria, third-party). Capturamos
 * QUALQUER outro JSON > 500 bytes — assim nao perdemos nenhum endpoint
 * interno do ML que possa ter os dados de cards/sub-status.
 */
const URL_BLACKLIST_PATTERNS = [
  /google-analytics/,
  /googletagmanager/,
  /facebook\.com/,
  /facebook\.net/,
  /doubleclick/,
  /datadog/,
  /newrelic/,
  /sentry\.io/,
  /\/captcha/,
  /melidata/,
  /\/v3\/melidata/,
  /\/p\.gif/,
  /\.css(\?|$)/,
  /\.js(\?|$)/,
];

function shouldCaptureUrl(url) {
  // So aceita URLs de dominios do ML (mercadolivre.com.br, mercadolibre,
  // mlstatic). Ignora assets externos.
  if (
    !url.includes("mercadolivre") &&
    !url.includes("mercadolibre") &&
    !url.includes("mlstatic")
  ) {
    return false;
  }
  return !URL_BLACKLIST_PATTERNS.some((re) => re.test(url));
}

/**
 * Navega numa URL especifica e captura responses XHR + DOM snapshot.
 * Retorna { url, xhrJsonResponses: [{url, body}], domHtml, domChipsText }.
 *
 * Esta funcao NAO renova browser — recebe page e ja navega.
 */
/**
 * Faz fetches autenticados DIRETO no contexto da page (usa cookies da sessao
 * do Chromium ja autenticado). Util porque os endpoints de sub-cards
 * (/operations-dashboard/tabs, /operations-dashboard/actions, /marketshops/list)
 * sao disparados via onRenderEvents pelo JS client-side do ML, mas em browser
 * headless isso pode nao disparar (timing ou anti-bot). Fazer fetch direto
 * contorna essa limitacao.
 *
 * Retorna { [key]: { ok, status, size, body, error } }
 */
async function fetchDirectEndpoints(page, tabFilter, storeUrlParam) {
  const storeForQuery = storeUrlParam || "all";

  // Extrai CSRF token do meta tag (ML usa pra validar requests XHR)
  let csrfToken = null;
  try {
    csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta ? meta.getAttribute("content") : null;
    });
  } catch {
    // ignore
  }

  // Headers comuns que ML espera em requests XHR reais
  const commonHeaders = {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  };

  const endpoints = {
    operations_dashboard_tabs: {
      path: `/sales-omni/packs/marketshops/operations-dashboard/tabs?sellerSegmentType=professional&filters=${encodeURIComponent(tabFilter || "TAB_TODAY")}&subFilters=&store=${encodeURIComponent(storeForQuery)}&gmt=-03:00`,
      headers: { ...commonHeaders, "x-scope": "tabs-mlb" },
    },
    operations_dashboard_actions: {
      path: `/sales-omni/packs/marketshops/operations-dashboard/actions?store=${encodeURIComponent(storeForQuery)}&sellerCBTParent=false&callers=`,
      headers: { ...commonHeaders, "x-scope": "tabs-mlb" },
    },
    marketshops_list: {
      path: `/sales-omni/packs/marketshops/list?referrer=web-wrapper&filters=${encodeURIComponent(tabFilter || "TAB_TODAY")}&subFilters=&search=&limit=50&offset=0&startPeriod=&store=${encodeURIComponent(storeForQuery)}`,
      headers: commonHeaders,
    },
    // Variante: path com /api/ no meio (pode ser reescrito no nginx)
    operations_dashboard_tabs_api: {
      path: `/sales-omni/api/packs/marketshops/operations-dashboard/tabs?sellerSegmentType=professional&filters=${encodeURIComponent(tabFilter || "TAB_TODAY")}&subFilters=&store=${encodeURIComponent(storeForQuery)}&gmt=-03:00`,
      headers: { ...commonHeaders, "x-scope": "tabs-mlb" },
    },
  };

  const results = { _csrf_token_found: csrfToken ? csrfToken.slice(0, 20) + "..." : null };
  for (const [key, cfg] of Object.entries(endpoints)) {
    try {
      const result = await page.evaluate(
        async ({ path, headers }) => {
          try {
            const res = await fetch(path, {
              method: "GET",
              headers,
              credentials: "include",
            });
            const text = await res.text();
            let body = null;
            try {
              body = JSON.parse(text);
            } catch {
              // Slice maior (5000) pra pegar mensagem de erro
              body = text.slice(0, 5000);
            }
            // Retorna alguns response headers pra debug
            const respHeaders = {};
            res.headers.forEach((v, k) => {
              respHeaders[k] = v;
            });
            return {
              ok: res.ok,
              status: res.status,
              size: text.length,
              headers: respHeaders,
              body,
            };
          } catch (err) {
            return { ok: false, error: String(err && err.message ? err.message : err) };
          }
        },
        { path: cfg.path, headers: cfg.headers }
      );
      results[key] = { url: cfg.path, ...result };
    } catch (err) {
      results[key] = {
        url: cfg.path,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return results;
}

async function captureTabStore(page, tabFilter, storeUrlParam, timeoutMs, waitMs = 8000, doFetchDirect = false) {
  const params = new URLSearchParams();
  if (tabFilter) params.set("filters", tabFilter);
  if (storeUrlParam) params.set("store", storeUrlParam);
  params.set("limit", "50");
  params.set("offset", "0");
  const targetUrl = `${ML_VENDAS_URL}?${params.toString()}`;

  // Buffer de XHRs interceptados nesta navegacao
  const xhrJsonResponses = [];
  let totalSeen = 0;
  let blacklisted = 0;
  let nonJson = 0;
  const responseHandler = async (response) => {
    try {
      totalSeen++;
      const url = response.url();
      if (!shouldCaptureUrl(url)) {
        blacklisted++;
        return;
      }
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        nonJson++;
        return;
      }
      // Limita tamanho pra nao explodir memoria
      const body = await response.text();
      if (!body || body.length > 2 * 1024 * 1024) return; // skip > 2MB
      // Pula JSONs muito pequenos (provavel telemetria/ack)
      if (body.length < 100) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return;
      }
      // Limita a 60 XHRs por navegacao (mais espaco pra ver tudo)
      if (xhrJsonResponses.length >= 60) return;
      xhrJsonResponses.push({
        url,
        status: response.status(),
        size: body.length,
        body: parsed,
      });
    } catch {
      // best-effort — algumas responses sao streamed e nao da pra ler
    }
  };

  page.on("response", responseHandler);

  let navError = null;
  let clicksAttempted = [];
  try {
    // domcontentloaded — networkidle nao funciona porque ML mantem SSE
    // (event-request) aberto o tempo todo, rede nunca fica idle.
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Wait generoso pra dar tempo de a SPA hidratar e os XHRs
    // de dados serem chamados apos as configs dos microfrontends.
    await page.waitForTimeout(waitMs);

    // ── PLANO C v3: simular interacao pra forcar disparo dos XHRs ──
    // v3: clicamos em tab DIFERENTE do atual pra forcar mudanca (o ML so
    // dispara /operations-dashboard/* quando o tab ativo muda). Tambem
    // capturamos DOM debug SEMPRE (nao so quando falha).
    // O JS do ML configura onRenderEvents em /operations-dashboard/tabs
    // mas NAO dispara em browser headless. Solucao: clicar explicitamente
    // nos tabs pra acionar os events manualmente.
    //
    // v2 melhorias:
    //   - Detecta botoes por data-testid/aria-label alem de texto
    //   - Captura sample do DOM pra debug quando nao acha nada
    //   - Tenta clicar por indice (o 1o/2o/3o elemento <button> dentro do
    //     tablist) caso os textos estejam vazios (skeleton loading)
    clicksAttempted = await page.evaluate(async (ctx) => {
      const attempts = [];
      // Clica em TODOS os 4 tabs, comecando pelos DIFERENTES da atual
      // e terminando voltando ao atual. Isso garante que o ML dispare
      // o fetch de TODAS as listas (mudanca de tab = novo /event-request
      // grande com rows populadas).
      //
      // Exemplo: se current=TAB_TODAY, clica order: NEXT_DAYS, IN_THE_WAY,
      // FINISHED, TODAY (volta). ML dispara 4 event-requests grandes.
      const allLabels = [
        { label: "Envios de hoje", id: "TAB_TODAY" },
        { label: "Próximos dias", id: "TAB_NEXT_DAYS" },
        { label: "Em trânsito", id: "TAB_IN_THE_WAY" },
        { label: "Finalizadas", id: "TAB_FINISHED" },
      ];
      // Ordena: outras primeiro (pra nao dar no-op inicial),
      // atual por ultimo (volta, forca novo fetch pro current)
      const labels = [
        ...allLabels.filter((l) => l.id !== ctx.currentTab),
        ...allLabels.filter((l) => l.id === ctx.currentTab),
      ];

      // Strategy v4: mirar no INPUT radio do Andes Segmented Control
      // O ML renderiza:
      //   <input type="radio" value="TAB_NEXT_DAYS" id="_r_XX_-segment-input-TAB_NEXT_DAYS">
      //   <label for="_r_XX_-segment-input-TAB_NEXT_DAYS">145Próximos dias</label>
      // Clicar no radio dispara change event (o que o ML listena).
      // Se nao achar radio, tenta o label (for attribute ativa o radio).
      for (const { label, id } of labels) {
        let clicked = false;

        // Tentativa 1: input radio via value=TAB_XXX
        const radio = document.querySelector(`input[type="radio"][value="${id}"]`);
        if (radio && !radio.checked) {
          try {
            radio.scrollIntoView({ block: "center" });
            // Dispatchar change event tambem, caso click puro nao baste
            radio.click();
            // Forca trigger de change + input events (React sometimes needs)
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            radio.dispatchEvent(new Event("input", { bubbles: true }));
            attempts.push({
              label,
              id,
              clicked: true,
              tagName: "INPUT",
              matchType: "radio_value",
              selector: `input[type="radio"][value="${id}"]`,
              inputId: radio.id,
            });
            clicked = true;
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          } catch (err) {
            attempts.push({ label, id, clicked: false, matchType: "radio_value", error: String(err) });
          }
        } else if (radio && radio.checked) {
          attempts.push({ label, id, clicked: false, reason: "radio_already_checked" });
          continue;
        }

        // Tentativa 2: label[for*=TAB_XXX]
        const lbl = document.querySelector(`label[for*="${id}"]`);
        if (lbl) {
          try {
            lbl.scrollIntoView({ block: "center" });
            lbl.click();
            attempts.push({
              label,
              id,
              clicked: true,
              tagName: "LABEL",
              matchType: "label_for",
              textSample: (lbl.textContent || "").trim().slice(0, 50),
            });
            clicked = true;
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          } catch (err) {
            attempts.push({ label, id, clicked: false, matchType: "label_for", error: String(err) });
          }
        }

        // Tentativa 3: fallback pra busca por texto amplo
        if (!clicked) {
          const all = document.querySelectorAll(
            "button, a, label, div, span, li, input"
          );
          for (const el of all) {
            const text = (el.textContent || "").trim();
            const value = el.getAttribute("value") || "";
            if (value === id || text.includes(label)) {
              try {
                el.scrollIntoView({ block: "center" });
                el.click();
                attempts.push({
                  label,
                  id,
                  clicked: true,
                  tagName: el.tagName,
                  matchType: value === id ? "value_attr" : "text_includes",
                  textSample: text.slice(0, 60),
                });
                clicked = true;
                await new Promise((r) => setTimeout(r, 2500));
                break;
              } catch (err) {
                // keep trying
              }
            }
          }
        }

        if (!clicked) {
          attempts.push({ label, id, clicked: false, reason: "not_found" });
        }
      }

      // Dump DOM SEMPRE (nao so quando falha) — ajuda a entender por que
      // alguns clicks funcionam e outros nao.
      const dom_debug = {
        total_buttons: document.querySelectorAll("button").length,
        total_links: document.querySelectorAll("a").length,
        total_testid: document.querySelectorAll("[data-testid]").length,
        total_role_tab: document.querySelectorAll('[role="tab"]').length,
        tablist_elements: Array.from(
          document.querySelectorAll('[role="tablist"], [role="tab"]')
        ).slice(0, 10).map((el) => ({
          tag: el.tagName,
          testId: el.getAttribute("data-testid"),
          role: el.getAttribute("role"),
          dataId: el.getAttribute("data-id"),
          className: (el.className?.toString?.() || "").slice(0, 80),
          text: (el.textContent || "").trim().slice(0, 80),
        })),
        // Sample dos primeiros 30 testids visiveis
        sample_testids: Array.from(document.querySelectorAll("[data-testid]"))
          .slice(0, 30)
          .map((el) => ({
            testId: el.getAttribute("data-testid"),
            tag: el.tagName,
            text: (el.textContent || "").trim().slice(0, 40),
          })),
        // Elementos com classes que sugerem "segment" / "tab"
        segment_like: Array.from(
          document.querySelectorAll(
            '[class*="segment"], [class*="tab"], [class*="filter-dashboard"]'
          )
        ).slice(0, 15).map((el) => ({
          tag: el.tagName,
          className: el.className?.toString?.().slice(0, 120),
          text: (el.textContent || "").trim().slice(0, 80),
        })),
        // Buscar especificamente elementos com TAB_TODAY/NEXT_DAYS no markup
        tab_id_elements: Array.from(document.querySelectorAll("*"))
          .filter((el) => {
            const attrs = Array.from(el.attributes || []).map((a) => a.value).join(" ");
            return /TAB_(TODAY|NEXT_DAYS|IN_THE_WAY|FINISHED)/.test(attrs);
          })
          .slice(0, 10)
          .map((el) => ({
            tag: el.tagName,
            attrs: Array.from(el.attributes || []).map((a) => `${a.name}=${a.value.slice(0, 40)}`).join(", ").slice(0, 200),
            text: (el.textContent || "").trim().slice(0, 60),
          })),
      };
      attempts.push({ _dom_debug: dom_debug });

      return attempts;
    }, { currentTab: tabFilter });

    // Espera mais 10s pra os clicks dispararem os XHRs (se algum click rolou)
    // Cada click tem 2.5s de delay antes do proximo, entao o ultimo fetch
    // tem tempo de comecar. Esse wait final pega o retorno dele.
    if (Array.isArray(clicksAttempted) && clicksAttempted.some((a) => a.clicked)) {
      await page.waitForTimeout(10000);
    }
  } catch (err) {
    navError = err instanceof Error ? err.message : String(err);
  } finally {
    page.off("response", responseHandler);
  }

  // Snapshot leve do DOM pra fallback (texto dos chips)
  let domChipsText = null;
  try {
    domChipsText = await page.evaluate(() => {
      const labels = ["Envios de hoje", "Próximos dias", "Em trânsito", "Finalizadas"];
      const result = {};
      const allElements = document.querySelectorAll("button, div, a, span, li");
      for (const label of labels) {
        for (const el of allElements) {
          const text = (el.textContent || "").trim();
          if (text.startsWith(label) && text.length < label.length + 15) {
            const m = text.match(new RegExp(`${label}[\\s\\n]*(\\d+)`));
            if (m) {
              result[label] = parseInt(m[1], 10);
              break;
            }
          }
        }
      }
      return result;
    });
  } catch {
    // ignore
  }

  // ── ESTRATEGIA NOVA: extrair dados embeded no HTML (SSR) ──
  // ML usa Next.js que coloca state inicial em <script id="__PRELOADED_STATE__">,
  // <script id="__NEXT_DATA__">, ou window.__APP_DATA__. Procuramos esses
  // padroes no HTML e tambem qualquer <script type="application/json">
  // grande (>1KB) que possa conter cards/sub-status.
  let ssrPayloads = [];
  try {
    ssrPayloads = await page.evaluate(() => {
      const out = [];
      // 1. Scripts com IDs comuns de SSR
      const scriptIds = [
        "__PRELOADED_STATE__",
        "__NEXT_DATA__",
        "__APP_DATA__",
        "__APOLLO_STATE__",
        "__INITIAL_STATE__",
        "__REDUX_STATE__",
        "serverState",
        "__data",
      ];
      for (const id of scriptIds) {
        const el = document.getElementById(id);
        if (el && el.textContent) {
          out.push({
            source: `script#${id}`,
            size: el.textContent.length,
            content: el.textContent.slice(0, 500_000), // cap 500KB
          });
        }
      }
      // 2. Qualquer <script type="application/json"> > 1KB
      const jsonScripts = document.querySelectorAll('script[type="application/json"]');
      jsonScripts.forEach((el, i) => {
        const txt = el.textContent || "";
        if (txt.length > 1000) {
          out.push({
            source: `script[type=application/json][${i}]${el.id ? `#${el.id}` : ""}`,
            size: txt.length,
            content: txt.slice(0, 500_000),
          });
        }
      });
      // 3. Globals window que possam ter dados
      const globalKeys = [
        "__PRELOADED_STATE__",
        "__APP_DATA__",
        "__INITIAL_STATE__",
        "__APOLLO_STATE__",
      ];
      for (const k of globalKeys) {
        try {
          // eslint-disable-next-line no-undef
          const v = window[k];
          if (v && typeof v === "object") {
            const json = JSON.stringify(v);
            if (json.length > 100) {
              out.push({
                source: `window.${k}`,
                size: json.length,
                content: json.slice(0, 500_000),
              });
            }
          }
        } catch {
          // ignore
        }
      }
      return out;
    });
  } catch {
    // ignore
  }

  // Parsea JSON dos SSR payloads (best-effort)
  for (const p of ssrPayloads) {
    try {
      p.body = JSON.parse(p.content);
      delete p.content; // economiza memoria
    } catch {
      // mantem como string
    }
  }

  // ── Captura snippet do HTML pra inspecao manual ──
  // Procura por padroes de texto que sugiram onde estao os dados de cards
  // (ex: "Envios de hoje", numero, etc) no HTML cru.
  let htmlSnippet = null;
  let htmlMatches = null;
  try {
    const html = await page.content();
    htmlSnippet = `[HTML total: ${html.length} bytes]\n\n` + html.slice(0, 50000);

    // Procura matches de palavras-chave dos cards (caso-insensitive)
    const keywords = [
      "Envios de hoje",
      "Próximos dias",
      "Em trânsito",
      "Finalizadas",
      "Etiquetas para imprimir",
      "Coleta",
      "TAB_TODAY",
      "TAB_NEXT_DAYS",
      "Para enviar",
    ];
    htmlMatches = {};
    for (const kw of keywords) {
      const idx = html.indexOf(kw);
      if (idx >= 0) {
        // Pega 200 chars de contexto
        const start = Math.max(0, idx - 100);
        const end = Math.min(html.length, idx + 200);
        htmlMatches[kw] = `(pos ${idx}) ...${html.slice(start, end)}...`;
      }
    }
  } catch {
    // ignore
  }

  // ── OPCAO D: fetch direto dos endpoints descobertos ──
  // Chamada dos 3 endpoints (operations-dashboard/tabs, /actions,
  // /marketshops/list) via page.evaluate(fetch(...)). Executa dentro
  // do contexto da page ja autenticada no ML. Contorna o problema dos
  // onRenderEvents nao dispararem em headless.
  let directFetches = null;
  if (doFetchDirect) {
    try {
      directFetches = await fetchDirectEndpoints(page, tabFilter, storeUrlParam);
    } catch (err) {
      directFetches = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    url: targetUrl,
    xhrJsonResponses,
    domChipsText,
    ssrPayloads,
    htmlSnippet,
    htmlMatches,
    directFetches,
    clicksAttempted,
    navError,
    capture_stats: {
      total_seen: totalSeen,
      blacklisted,
      non_json: nonJson,
      captured: xhrJsonResponses.length,
      ssr_payloads_found: ssrPayloads.length,
      html_keywords_found: htmlMatches ? Object.keys(htmlMatches).length : 0,
      direct_fetches: directFetches ? Object.keys(directFetches).length : 0,
      clicks_attempted: clicksAttempted ? clicksAttempted.length : 0,
      clicks_successful: clicksAttempted ? clicksAttempted.filter((a) => a.clicked).length : 0,
    },
  };
}

/**
 * Scrape FULL — navega em cada tab × store e captura tudo.
 * Demora ~30-60s pra cobrir 4 tabs × 3 stores = 12 navegacoes.
 *
 * Quando `singleTab` e `singleStore` sao especificados, faz APENAS 1
 * navegacao (~10-15s). Util pra debug rapido sem esperar o full scrape.
 *
 * Retorna:
 *   { ok: true, tabs: { [tabKey]: { [storeKey]: <captura> } }, capturedAt }
 *   { ok: false, error, message }
 */
export async function scrapeMlSellerCenterFull({
  timeoutMs = 30_000,
  singleTab = null,
  singleStore = null,
  waitMs = 8000,
  fetchDirect = false,
} = {}) {
  if (!isScraperConfigured()) {
    return { ok: false, error: "no_state", message: "Storage state nao configurado" };
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    return { ok: false, error: "playwright_missing", message: "Playwright nao instalado" };
  }

  const storageState = loadStorageState();
  if (!storageState) {
    return { ok: false, error: "no_state", message: "Storage state invalido" };
  }

  let browser;
  const captures = {};
  try {
    // Args otimizados pra reduzir RAM (~150MB → ~80MB) — importante em
    // VPS pequena. --single-process roda tudo numa thread (renderer +
    // browser process) evitando overhead. --disable-* corta features
    // que nao usamos no scraping.
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--single-process",
      ],
    });
    // Viewport menor (1280x720 vs 1920x1080) reduz memoria do renderer
    const context = await browser.newContext({
      storageState,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      // Bloqueia recursos pesados que nao precisamos pro scraping
      // (imagens, fonts, midia). Reduz drasticamente trafego e memoria.
    });
    // Bloqueia recursos pesados via route handler
    await context.route(
      "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf,mp4,webm}",
      (route) => route.abort()
    );
    const page = await context.newPage();

    // Verifica sessao com 1a navegacao
    const probeUrl = ML_VENDAS_URL;
    await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/auth") ||
      currentUrl.includes("/authorization")
    ) {
      lastError = {
        error: "session_expired",
        message: "Session expirada — admin precisa re-login",
        timestamp: new Date().toISOString(),
      };
      log.warn("[full-scrape] Session expirada — abortando");
      return { ok: false, error: "session_expired", message: "Session expirada" };
    }

    // Itera tab × store (ou single se especificado)
    const tabsToRun = singleTab
      ? ML_TABS.filter((t) => t.key === singleTab)
      : ML_TABS;
    const storesToRun = singleStore ? [singleStore] : ML_STORES;
    for (const tab of tabsToRun) {
      captures[tab.key] = {};
      for (const store of storesToRun) {
        const storeParam = storeToUrlParam(store);
        log.info(`[full-scrape] capturando ${tab.key} × ${store}`);
        try {
          const capture = await captureTabStore(
            page,
            tab.filter,
            storeParam,
            timeoutMs,
            waitMs,
            fetchDirect
          );
          captures[tab.key][store] = {
            url: capture.url,
            store_url_param: storeParam,
            xhr_count: capture.xhrJsonResponses.length,
            xhr_responses: capture.xhrJsonResponses,
            dom_chips_text: capture.domChipsText,
            // FIX BUG: antes ssrPayloads/htmlMatches/htmlSnippet nao
            // chegavam no retorno — renderer HTML procurava mas achava
            // undefined. Agora passa tudo adiante.
            ssrPayloads: capture.ssrPayloads,
            htmlMatches: capture.htmlMatches,
            htmlSnippet: capture.htmlSnippet,
            directFetches: capture.directFetches,
            clicksAttempted: capture.clicksAttempted,
            nav_error: capture.navError,
            capture_stats: capture.capture_stats,
          };
        } catch (err) {
          captures[tab.key][store] = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    const result = {
      ok: true,
      tabs: captures,
      stores_scraped: ML_STORES,
      capturedAt: new Date().toISOString(),
    };

    cachedFullResult = {
      data: result,
      capturedAt: result.capturedAt,
      expiresAt: Date.now() + SCRAPER_CACHE_TTL_MS,
    };
    lastError = null;

    return result;
  } catch (err) {
    const errorInfo = {
      error: "network",
      message: err instanceof Error ? err.message : String(err),
    };
    lastError = { ...errorInfo, timestamp: new Date().toISOString() };
    log.error("[full-scrape] falhou", err instanceof Error ? err : new Error(String(err)));
    return { ok: false, ...errorInfo };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Retorna o ultimo scrape FULL bem-sucedido (do cache).
 * Stale = true se passou do TTL.
 */
export function getCachedFullResult() {
  if (!cachedFullResult) return null;
  if (cachedFullResult.expiresAt <= Date.now()) {
    return { ...cachedFullResult, stale: true };
  }
  return cachedFullResult;
}

/**
 * Retorna os chips do cache ou null se vazio/expirado.
 * Não dispara scraping novo — isso é responsabilidade do cron.
 */
export function getUiChipCounts() {
  const cached = getCachedScraperResult();
  if (!cached || cached.stale) return null;
  return {
    today: cached.data.today,
    upcoming: cached.data.upcoming,
    in_transit: cached.data.in_transit,
    finalized: cached.data.finalized,
    captured_at: cached.capturedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════
// LIVE SNAPSHOT — Fase 2 (engenharia reversa concluida)
// ═══════════════════════════════════════════════════════════════════
// Apos descobrir que o ML retorna:
//   - 4 contadores principais via event-request pequeno (~13KB)
//   - Lista completa de pedidos de cada tab via event-request grande
//     (~500KB) quando clicamos no radio da tab
//
// Exportamos `scrapeMlLiveSnapshot()` que roda scraper + clicks em TODAS
// as tabs e retorna snapshot normalizado pra o frontend consumir 1:1.

// Cache do snapshot (compartilhado com getCachedLiveSnapshot)
let cachedLiveSnapshot = null;

/**
 * Extrai contadores dos segments do event-request pequeno.
 * Retorna { today, upcoming, in_transit, finalized } ou null.
 */
function extractCountersFromXhrs(xhrs) {
  for (const x of xhrs) {
    if (!x || !x.url || !x.url.includes("event-request")) continue;
    const body = x.body;
    if (!body) continue;
    // Procura brick segmented_actions_marketshops
    const stack = [body];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (cur.id === "segmented_actions_marketshops" && cur.data?.segments) {
        const counters = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
        for (const seg of cur.data.segments) {
          const count = parseInt(String(seg.count || "0"), 10) || 0;
          if (seg.id === "TAB_TODAY") counters.today = count;
          else if (seg.id === "TAB_NEXT_DAYS") counters.upcoming = count;
          else if (seg.id === "TAB_IN_THE_WAY") counters.in_transit = count;
          else if (seg.id === "TAB_FINISHED") counters.finalized = count;
        }
        return counters;
      }
      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
      } else {
        for (const v of Object.values(cur)) stack.push(v);
      }
    }
  }
  return null;
}

/**
 * Extrai pedidos (rows) de um event-request body — formato ML bricks.
 * Retorna array de pedidos normalizados: { pack_id, order_id, status_text,
 * description, buyer_name, store_label, date_text, shipment_ids,
 * primary_action, url_detail, tab_filter }.
 */
function extractOrdersFromBody(body) {
  const orders = [];
  const stack = [body];
  let tabFilter = null;

  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;

    // row brick
    if (
      typeof cur.id === "string" &&
      cur.id.startsWith("row-") &&
      cur.uiType === "row" &&
      cur.data?.identificationData
    ) {
      const d = cur.data;
      const idData = d.identificationData || {};
      const statusData = d.statusActionsData || {};
      const idStr = (idData.id || "").replace(/^#/, "");
      // row id format: row-{pack_id}_{order_id}
      const m = cur.id.match(/^row-(\d+)_(\d+)$/);
      const packId = m ? m[1] : idStr;
      const orderId = m ? m[2] : idStr;

      // extrai shipmentIds do primaryAction (quando existir)
      let shipmentIds = [];
      let primaryActionText = null;
      if (statusData.primaryAction) {
        primaryActionText = statusData.primaryAction.text || null;
        const events = statusData.primaryAction.events || [];
        for (const ev of events) {
          if (ev.type === "request" && ev.data?.body?.shipmentIds) {
            shipmentIds = ev.data.body.shipmentIds;
            break;
          }
        }
      }

      // tab filter vem dentro dos eventos de tracking — procura no primeiro
      if (!tabFilter) {
        const events = statusData.primaryAction?.events || [];
        for (const ev of events) {
          if (ev.type === "tracking_event" && ev.data?.tracks) {
            for (const t of ev.data.tracks) {
              const f = t.data?.eventData?.filters;
              if (typeof f === "string" && f.startsWith("TAB_")) {
                tabFilter = f;
                break;
              }
            }
          }
          if (tabFilter) break;
        }
      }

      // url do detalhe vem dentro de secondaryActions[0]
      let urlDetail = null;
      const sec = statusData.secondaryActions?.actions || [];
      for (const a of sec) {
        if (a.url && typeof a.url === "string") {
          urlDetail = a.url;
          break;
        }
      }

      orders.push({
        pack_id: packId,
        order_id: orderId,
        row_id: cur.id,
        status_text: statusData.status || null,
        description: statusData.description || null,
        priority: statusData.priority || "normal",
        buyer_name: idData.buyer?.name || null,
        buyer_nickname: idData.buyer?.nickName || null,
        store_label: idData.store?.pill?.label || null,
        date_text: idData.date || null,
        channel: idData.pill?.channel || null,
        reputation_text: idData.reputationInfo?.text || null,
        reputation_priority: idData.reputationInfo?.priority || null,
        shipment_ids: shipmentIds,
        primary_action_text: primaryActionText,
        messages_unread: !!idData.messengerLink?.messagesUnread,
        new_messages_amount: idData.messengerLink?.newMessagesAmount || 0,
        url_detail: urlDetail,
      });
    }

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  return { orders, tab_filter: tabFilter };
}

/**
 * Procura nos XHRs capturados o event-request grande de CADA tab e extrai
 * os pedidos dela. Retorna { today: [...], upcoming: [...], in_transit: [...],
 * finalized: [...] } — cada array com pedidos normalizados.
 */
function extractOrdersByTab(xhrs) {
  const ordersByTab = {
    today: [],
    upcoming: [],
    in_transit: [],
    finalized: [],
  };
  // O event-request grande tem size > 50KB e contem rows.
  // Ordenamos por size desc pra processar os maiores primeiro.
  const bigXhrs = xhrs
    .filter(
      (x) =>
        x.url?.includes("event-request") &&
        x.size > 30_000 &&
        x.body
    )
    .sort((a, b) => b.size - a.size);

  for (const x of bigXhrs) {
    const { orders, tab_filter } = extractOrdersFromBody(x.body);
    if (!orders.length || !tab_filter) continue;
    let tabKey = null;
    if (tab_filter === "TAB_TODAY") tabKey = "today";
    else if (tab_filter === "TAB_NEXT_DAYS") tabKey = "upcoming";
    else if (tab_filter === "TAB_IN_THE_WAY") tabKey = "in_transit";
    else if (tab_filter === "TAB_FINISHED") tabKey = "finalized";
    if (!tabKey) continue;
    // Evita duplicatas (dedup por pack_id)
    const existingIds = new Set(ordersByTab[tabKey].map((o) => o.pack_id));
    for (const o of orders) {
      if (!existingIds.has(o.pack_id)) {
        ordersByTab[tabKey].push(o);
        existingIds.add(o.pack_id);
      }
    }
  }

  return ordersByTab;
}

/**
 * Agrega sub-cards a partir dos status_text dos pedidos.
 * Imita os sub-cards que o ML mostraria em /operations-dashboard/tabs
 * (que a gente nao consegue capturar em headless).
 *
 * Categorias (case-insensitive, match por includes no status_text):
 *   today:
 *     label_ready_to_print: "Etiqueta pronta para impressão"
 *     ready_for_pickup:     "Pronto para coleta"
 *     other_today:          demais status
 *   upcoming:
 *     scheduled_pickup:     "Para entregar na coleta do dia X"
 *     label_ready:          "Etiqueta pronta"
 *     other_upcoming:       demais
 *   in_transit:
 *     in_transit:           todos (ja sao em transito)
 *   finalized:
 *     delivered:            "Entregue"
 *     cancelled_seller:     "Venda cancelada. Não envie"
 *     cancelled_buyer:      "Cancelada pelo comprador"
 *     other_finalized:      demais
 */
function aggregateSubCards(ordersByTab) {
  const subCards = {
    today: {
      label_ready_to_print: 0,
      ready_for_pickup: 0,
      ready_to_send: 0, // alias
      with_unread_messages: 0,
      total: 0,
      by_status: {},
    },
    upcoming: {
      scheduled_pickup: 0,
      label_ready_to_print: 0,
      total: 0,
      by_pickup_date: {},
      by_status: {},
    },
    in_transit: {
      in_transit: 0,
      total: 0,
      by_status: {},
    },
    finalized: {
      delivered: 0,
      cancelled_seller: 0,
      cancelled_buyer: 0,
      with_claims: 0,
      total: 0,
      by_status: {},
    },
  };

  const addStatus = (bucket, status) => {
    if (!status) return;
    subCards[bucket].by_status[status] = (subCards[bucket].by_status[status] || 0) + 1;
  };

  for (const [tabKey, orders] of Object.entries(ordersByTab)) {
    const sub = subCards[tabKey];
    if (!sub) continue;
    sub.total = orders.length;
    for (const o of orders) {
      const s = (o.status_text || "").toLowerCase();
      addStatus(tabKey, o.status_text);
      if (o.messages_unread) sub.with_unread_messages = (sub.with_unread_messages || 0) + 1;

      if (tabKey === "today") {
        if (s.includes("etiqueta pronta para impressão") || s.includes("etiqueta pronta")) {
          sub.label_ready_to_print++;
        } else if (s.includes("pronto para coleta")) {
          sub.ready_for_pickup++;
        }
        if (s.includes("pronto") || s.includes("etiqueta pronta")) {
          sub.ready_to_send++;
        }
      } else if (tabKey === "upcoming") {
        if (s.includes("para entregar na coleta do dia")) {
          sub.scheduled_pickup++;
          // extrai data
          const dateMatch = o.status_text?.match(/coleta do dia (\d+ de \w+)/i);
          if (dateMatch) {
            const d = dateMatch[1];
            sub.by_pickup_date[d] = (sub.by_pickup_date[d] || 0) + 1;
          }
        } else if (s.includes("etiqueta pronta")) {
          sub.label_ready_to_print++;
        }
      } else if (tabKey === "in_transit") {
        sub.in_transit++;
      } else if (tabKey === "finalized") {
        if (s.includes("entregue")) {
          sub.delivered++;
        } else if (s.includes("não envie") || s.includes("cancelada. não")) {
          sub.cancelled_seller++;
        } else if (s.includes("cancelada pelo comprador") || s.includes("cancelado")) {
          sub.cancelled_buyer++;
        }
        if (o.reputation_priority && o.reputation_priority !== "NORMAL") {
          sub.with_claims++;
        }
      }
    }
  }

  return subCards;
}

/**
 * Scrape FASE 2: live snapshot normalizado.
 * 1. Abre ML Seller Center
 * 2. Clica em todos os 4 tabs pra capturar XHRs grandes de cada um
 * 3. Extrai counters + pedidos normalizados + sub-cards agregados
 * 4. Retorna JSON estruturado pro frontend
 */
export async function scrapeMlLiveSnapshot({ timeoutMs = 180_000 } = {}) {
  // Estrategia: 2 navegacoes com tabs iniciais DIFERENTES.
  //
  // Cada navegacao clica nos 3 outros tabs + volta ao atual (4 clicks
  // total). O ML as vezes "perde" um click (cancel/timing/flaky) —
  // fazer 2 navegacoes com tabs iniciais diferentes garante que cada
  // tab tem 2 oportunidades de ser capturada.
  //
  // Nav 1 (abre em TODAY):     clicks NEXT_DAYS -> IN_THE_WAY -> FINISHED -> TODAY
  // Nav 2 (abre em NEXT_DAYS): clicks TODAY -> IN_THE_WAY -> FINISHED -> NEXT_DAYS
  //
  // Total:
  //   TODAY:      clicada 2x (1 volta + 1 outra)
  //   NEXT_DAYS:  clicada 2x
  //   IN_THE_WAY: clicada 2x
  //   FINISHED:   clicada 2x
  //
  // Tempo: ~60-90s. Timeout 180s pra folga.
  const allXhrs = [];
  let lastResult = null;

  const navPlan = [
    { key: "today", label: "Nav 1 (abre em TODAY)" },
    { key: "upcoming", label: "Nav 2 (abre em NEXT_DAYS)" },
  ];

  for (const nav of navPlan) {
    log.info(`[live-snapshot] ${nav.label}`);
    const r = await scrapeMlSellerCenterFull({
      timeoutMs: 90_000,
      singleTab: nav.key,
      singleStore: "outros",
      waitMs: 10_000,
      fetchDirect: false,
    });
    if (!r.ok) {
      // Se a 1a falhou, aborta. Se a 2a falhou mas a 1a rolou, usa so a 1a.
      if (allXhrs.length === 0) {
        return { ok: false, ...r };
      }
      log.warn(`[live-snapshot] ${nav.label} falhou — usando XHRs da nav anterior`);
      break;
    }
    lastResult = r;
    for (const tabKey of Object.keys(r.tabs)) {
      for (const storeKey of Object.keys(r.tabs[tabKey])) {
        const cap = r.tabs[tabKey][storeKey];
        if (cap?.xhr_responses) {
          allXhrs.push(...cap.xhr_responses);
        }
      }
    }
  }

  const counters = extractCountersFromXhrs(allXhrs);
  const ordersByTab = extractOrdersByTab(allXhrs);
  const subCards = aggregateSubCards(ordersByTab);

  const snapshot = {
    ok: true,
    capturedAt: new Date().toISOString(),
    counters: counters || { today: 0, upcoming: 0, in_transit: 0, finalized: 0 },
    sub_cards: subCards,
    orders: ordersByTab,
    stats: {
      total_orders: Object.values(ordersByTab).reduce((sum, o) => sum + o.length, 0),
      tabs_with_data: Object.entries(ordersByTab)
        .filter(([, o]) => o.length > 0)
        .map(([k]) => k),
      xhr_count: allXhrs.length,
      navs_successful: lastResult ? navPlan.findIndex((n) => n.key === "upcoming") + 1 : 1,
    },
  };

  // Cache 5 min
  cachedLiveSnapshot = {
    data: snapshot,
    capturedAt: snapshot.capturedAt,
    expiresAt: Date.now() + SCRAPER_CACHE_TTL_MS,
  };

  return snapshot;
}

/**
 * Retorna o ultimo live snapshot bem-sucedido (cache). Stale=true se
 * passou do TTL.
 */
export function getCachedLiveSnapshot() {
  if (!cachedLiveSnapshot) return null;
  if (cachedLiveSnapshot.expiresAt <= Date.now()) {
    return { ...cachedLiveSnapshot, stale: true };
  }
  return cachedLiveSnapshot;
}

// ─── Auto-refresh em background (single-flight) ──────────────────────
// Garante que apenas 1 scrape roda por vez. Se o cache está stale e
// alguém chama /api/ml/live-snapshot, dispara scrape em background sem
// bloquear a resposta (cliente recebe cache stale e próxima request
// após ~60-90s pega dados frescos).

let liveSnapshotInflightPromise = null;
let lastBackgroundRefreshStarted = 0;

/**
 * Se cache está stale (ou não existe) E não há scrape em andamento,
 * dispara um scrape em background. Não aguarda — retorna imediatamente.
 *
 * Idempotente: chamar várias vezes em sequência só dispara 1 scrape.
 */
export function maybeRefreshLiveSnapshotInBackground() {
  const now = Date.now();

  // Já tem scrape em andamento → não duplica
  if (liveSnapshotInflightPromise) {
    return { triggered: false, reason: "scrape_in_progress" };
  }

  // Cache fresh → não precisa refresh
  const cached = cachedLiveSnapshot;
  if (cached && cached.expiresAt > now) {
    return { triggered: false, reason: "cache_fresh" };
  }

  // Throttle: evita disparos múltiplos muito rápidos (guarda de 10s)
  if (now - lastBackgroundRefreshStarted < 10_000) {
    return { triggered: false, reason: "throttled" };
  }

  // Dispara scrape em background (fire-and-forget)
  lastBackgroundRefreshStarted = now;
  log.info("[live-snapshot] disparando refresh em background");
  liveSnapshotInflightPromise = scrapeMlLiveSnapshot({ timeoutMs: 180_000 })
    .then((result) => {
      log.info(`[live-snapshot] refresh background concluido (${result.ok ? "ok" : "erro"})`);
      return result;
    })
    .catch((err) => {
      log.error(
        "[live-snapshot] refresh background falhou",
        err instanceof Error ? err : new Error(String(err))
      );
      return { ok: false, error: "background_failed" };
    })
    .finally(() => {
      liveSnapshotInflightPromise = null;
    });

  return { triggered: true };
}

export function isLiveSnapshotScrapeInProgress() {
  return liveSnapshotInflightPromise !== null;
}
