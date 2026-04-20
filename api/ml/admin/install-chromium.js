// ─── Instalacao on-demand do Chromium do Playwright ──────────────────
//
// O Dockerfile tenta instalar o Chromium no build mas tem um
// `|| echo "[warn]"` que silencia falhas (alguns ambientes Coolify
// nao baixam Chromium em build por restricao de rede ou tempo).
//
// Esse endpoint executa `npx playwright install chromium --with-deps`
// dentro do container ja rodando, baixando os ~150MB necessarios.
//
// Endpoints:
//   GET /api/ml/admin/install-chromium             HTML com botao
//   POST /api/ml/admin/install-chromium            executa instalacao
//
// Auth: requireAdmin
// Tempo: 1-3 min dependendo da rede da VPS
// Tamanho: ~150MB baixados pra /ms-playwright/

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../../_lib/auth-server.js";

const execAsync = promisify(exec);

const PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright";

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Verifica se o Chromium ja esta instalado procurando no diretorio
 * padrao do PLAYWRIGHT_BROWSERS_PATH.
 */
function isChromiumInstalled() {
  try {
    if (!fs.existsSync(PLAYWRIGHT_BROWSERS_PATH)) return { installed: false };
    const dirs = fs.readdirSync(PLAYWRIGHT_BROWSERS_PATH);
    const chromiumDir = dirs.find((d) =>
      d.toLowerCase().includes("chromium")
    );
    if (!chromiumDir) return { installed: false, available_dirs: dirs };
    // Procura o executavel dentro
    const subPath = path.join(PLAYWRIGHT_BROWSERS_PATH, chromiumDir);
    let found = null;
    try {
      const sub = fs.readdirSync(subPath);
      // chrome-headless-shell-linux64/chrome-headless-shell ou chromium-XXX/chrome-linux/chrome
      for (const item of sub) {
        const inner = path.join(subPath, item);
        if (fs.statSync(inner).isDirectory()) {
          const innerFiles = fs.readdirSync(inner);
          for (const f of innerFiles) {
            if (
              f === "chrome-headless-shell" ||
              f === "chrome" ||
              f === "headless_shell"
            ) {
              found = path.join(inner, f);
              break;
            }
          }
        }
        if (found) break;
      }
    } catch {
      // ignore
    }
    return {
      installed: Boolean(found),
      directory: subPath,
      executable: found,
    };
  } catch (error) {
    return { installed: false, error: error.message };
  }
}

function renderHtml({ message = null, isError = false, output = null } = {}) {
  const status = isChromiumInstalled();
  const statusBlock = status.installed
    ? `<div class="status ok">
         ✅ Chromium instalado em: <code>${escapeHtml(status.executable || status.directory)}</code>
       </div>`
    : `<div class="status missing">
         ❌ Chromium NAO instalado (esperado em ${escapeHtml(PLAYWRIGHT_BROWSERS_PATH)})
         ${status.available_dirs ? `<br><small>Diretorios encontrados: ${escapeHtml(JSON.stringify(status.available_dirs))}</small>` : ""}
       </div>`;

  const messageBlock = message
    ? `<div class="message ${isError ? "error" : "success"}">${escapeHtml(message)}</div>`
    : "";

  const outputBlock = output
    ? `<details><summary>Output completo (clica pra expandir)</summary><pre>${escapeHtml(output)}</pre></details>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Instalar Chromium (Playwright)</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#f5f5f7;color:#1a1a1a;padding:24px;max-width:720px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:24px 0 12px;color:#666}
  .meta{color:#666;font-size:13px;margin-bottom:16px}
  .status{padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .status.ok{background:#f0fdf4;border:1px solid #86efac;color:#15803d}
  .status.missing{background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c}
  .message{padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .message.success{background:#dcfce7;border:1px solid #86efac;color:#15803d}
  .message.error{background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c}
  small{display:block;margin-top:4px;font-family:ui-monospace,monospace;font-size:11px;color:#666}
  code{background:#f0f0f5;padding:2px 6px;border-radius:3px;font-size:12px;font-family:ui-monospace,monospace}
  form{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;text-align:center}
  button{background:#3483fa;color:#fff;border:0;padding:14px 28px;border-radius:6px;font-weight:600;cursor:pointer;font-size:15px}
  button:hover{background:#2968c8}
  button:disabled{opacity:0.5;cursor:not-allowed}
  .warning{background:#fff8e1;border:1px solid #fde68a;color:#92400e;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px}
  pre{background:#1a1a1a;color:#86efac;padding:12px;border-radius:6px;overflow-x:auto;font-size:11px;line-height:1.4;max-height:400px;overflow-y:auto}
  details{margin-top:16px}
  .next{margin-top:24px;padding:16px;background:#eef4ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px}
  .next a{color:#1e40af;font-weight:600}
</style>
</head>
<body>
  <h1>🎭 Instalar Chromium (Playwright)</h1>
  <p class="meta">O Chromium e necessario pro scraper headless do ML.</p>

  ${statusBlock}
  ${messageBlock}
  ${outputBlock}

  <div class="warning">
    ⚠ Esta operacao vai baixar ~150MB e demora 1-3 minutos.
    NAO feche a aba durante o processo.
  </div>

  <form method="POST" action="/api/ml/admin/install-chromium">
    <button type="submit" ${status.installed ? "" : ""}>
      ${status.installed ? "↻ Reinstalar Chromium" : "📥 Instalar Chromium"}
    </button>
  </form>

  <div class="next">
    <strong>Apos instalar:</strong><br>
    Acesse <a href="/api/ml/admin/live-cards-debug?format=html&run=1">live-cards-debug?run=1</a>
    pra rodar o scraper com Chromium funcionando.
  </div>
</body>
</html>`;
}

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response
      .status(status)
      .send(`<!doctype html><html><body style="font-family:system-ui;padding:24px"><h1>Acesso negado</h1><p>${escapeHtml(error?.message || "")}</p></body></html>`);
  }

  if (request.method === "GET") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(renderHtml());
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ success: false, error: "Use GET ou POST." });
  }

  // Executa instalacao com timeout maior (5min)
  try {
    const env = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH,
    };
    const { stdout, stderr } = await execAsync(
      "npx playwright install chromium --with-deps 2>&1",
      {
        env,
        timeout: 5 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const output = `${stdout || ""}\n${stderr || ""}`.trim();
    const status = isChromiumInstalled();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(
      renderHtml({
        message: status.installed
          ? "✅ Chromium instalado com sucesso! Agora pode rodar o scraper."
          : "Comando executado mas Chromium ainda nao detectado. Veja output abaixo.",
        isError: !status.installed,
        output,
      })
    );
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`.trim();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(500).send(
      renderHtml({
        message: `Erro ao instalar: ${error.message}`,
        isError: true,
        output,
      })
    );
  }
}
