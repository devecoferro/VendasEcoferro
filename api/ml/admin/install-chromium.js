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

function findExecutable(subPath, names) {
  try {
    const sub = fs.readdirSync(subPath);
    for (const item of sub) {
      const inner = path.join(subPath, item);
      try {
        if (fs.statSync(inner).isDirectory()) {
          const innerFiles = fs.readdirSync(inner);
          for (const f of innerFiles) {
            if (names.includes(f)) {
              return path.join(inner, f);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Verifica se Chromium e chrome-headless-shell estao instalados.
 * Playwright 1.49+ por padrao usa chrome-headless-shell quando
 * headless: true — entao precisamos de AMBOS.
 */
function isChromiumInstalled() {
  try {
    if (!fs.existsSync(PLAYWRIGHT_BROWSERS_PATH)) {
      return { installed: false, headless_shell_installed: false };
    }
    const dirs = fs.readdirSync(PLAYWRIGHT_BROWSERS_PATH);

    // Chromium normal (chrome-linux64/chrome)
    const chromiumDir = dirs.find(
      (d) => d.toLowerCase().startsWith("chromium-") &&
              !d.toLowerCase().includes("headless_shell")
    );
    let chromiumExe = null;
    if (chromiumDir) {
      chromiumExe = findExecutable(
        path.join(PLAYWRIGHT_BROWSERS_PATH, chromiumDir),
        ["chrome", "chromium"]
      );
    }

    // Headless shell (chrome-headless-shell-linux64/chrome-headless-shell)
    const shellDir = dirs.find((d) =>
      d.toLowerCase().includes("headless_shell")
    );
    let shellExe = null;
    if (shellDir) {
      shellExe = findExecutable(
        path.join(PLAYWRIGHT_BROWSERS_PATH, shellDir),
        ["chrome-headless-shell", "headless_shell"]
      );
    }

    return {
      installed: Boolean(chromiumExe),
      headless_shell_installed: Boolean(shellExe),
      chromium_executable: chromiumExe,
      shell_executable: shellExe,
      directory: PLAYWRIGHT_BROWSERS_PATH,
      available_dirs: dirs,
    };
  } catch (error) {
    return {
      installed: false,
      headless_shell_installed: false,
      error: error.message,
    };
  }
}

function renderHtml({ message = null, isError = false, output = null } = {}) {
  const status = isChromiumInstalled();
  const allOk = status.installed && status.headless_shell_installed;
  const partialOk = status.installed || status.headless_shell_installed;
  const statusBlock = allOk
    ? `<div class="status ok">
         ✅ Chromium + headless-shell instalados:
         <br><code>${escapeHtml(status.chromium_executable || "")}</code>
         <br><code>${escapeHtml(status.shell_executable || "")}</code>
       </div>`
    : partialOk
      ? `<div class="status missing" style="background:#fff8e1;border-color:#fde68a;color:#92400e">
           ⚠ Instalacao PARCIAL — falta um dos browsers:
           <br>${status.installed ? "✅" : "❌"} chromium ${status.chromium_executable ? `(${escapeHtml(status.chromium_executable)})` : ""}
           <br>${status.headless_shell_installed ? "✅" : "❌"} chrome-headless-shell ${status.shell_executable ? `(${escapeHtml(status.shell_executable)})` : ""}
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

  // Procura o binary do playwright em varios locais (npm prune pode ter
  // removido do PATH global, mas o package.json o lista como dependency
  // entao o binary deve existir em node_modules/.bin)
  const candidateBinaries = [
    "/app/node_modules/.bin/playwright",
    "/app/node_modules/playwright/cli.js",
    "/app/node_modules/playwright-core/cli.js",
    "playwright", // fallback PATH
  ];

  const debugInfo = [];
  let workingCmd = null;

  for (const candidate of candidateBinaries) {
    try {
      if (candidate.startsWith("/") && !fs.existsSync(candidate)) {
        debugInfo.push(`❌ ${candidate} — nao existe`);
        continue;
      }
      // Testa rodando --version
      const cmd = candidate.endsWith(".js") ? `node ${candidate}` : candidate;
      const { stdout: ver } = await execAsync(`${cmd} --version 2>&1`, {
        timeout: 5_000,
      });
      debugInfo.push(`✅ ${candidate} → versao ${ver.trim()}`);
      workingCmd = cmd;
      break;
    } catch (err) {
      debugInfo.push(
        `❌ ${candidate} — falhou: ${(err.stderr || err.message || "").slice(0, 100)}`
      );
    }
  }

  // Se nem o package esta acessivel, instala primeiro
  if (!workingCmd) {
    debugInfo.push("");
    debugInfo.push("⚠ Binary do playwright nao encontrado. Tentando npm install...");
    try {
      const { stdout, stderr } = await execAsync(
        "cd /app && npm install playwright 2>&1",
        { timeout: 3 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }
      );
      debugInfo.push(stdout || "");
      debugInfo.push(stderr || "");
      // Tenta de novo
      if (fs.existsSync("/app/node_modules/.bin/playwright")) {
        workingCmd = "/app/node_modules/.bin/playwright";
        debugInfo.push("✅ playwright instalado via npm install");
      }
    } catch (err) {
      const fail = `Falha no npm install: ${err.message}\n${err.stderr || ""}\n${err.stdout || ""}`;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(500).send(
        renderHtml({
          message: "Nao foi possivel instalar o playwright via npm.",
          isError: true,
          output: `${debugInfo.join("\n")}\n\n${fail}`,
        })
      );
    }
  }

  if (!workingCmd) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(500).send(
      renderHtml({
        message: "Binary do playwright nao encontrado em nenhum local.",
        isError: true,
        output: debugInfo.join("\n"),
      })
    );
  }

  // Executa instalacao do Chromium + headless-shell (sem --with-deps porque
  // container pode nao ter permissao pra apt-get; deps geralmente ja vem
  // via Dockerfile).
  //
  // IMPORTANTE: Playwright 1.49+ por padrao usa chrome-headless-shell quando
  // headless: true. Se so instalar `chromium` o launch falha procurando
  // `/ms-playwright/chromium_headless_shell-XXXX/chrome-headless-shell-linux64/chrome-headless-shell`
  // Por isso instalamos AMBOS (chromium + chromium-headless-shell).
  try {
    const env = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH,
    };
    // Instala em UMA UNICA chamada (mais rapido — compartilha download cache)
    const { stdout, stderr } = await execAsync(
      `${workingCmd} install chromium chromium-headless-shell 2>&1`,
      {
        env,
        timeout: 8 * 60 * 1000, // 8min — 2 browsers podem demorar mais
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const output = `${debugInfo.join("\n")}\n\n=== INSTALL OUTPUT (chromium + headless-shell) ===\n${stdout || ""}\n${stderr || ""}`.trim();
    const status = isChromiumInstalled();
    const success = status.installed && status.headless_shell_installed;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(
      renderHtml({
        message: success
          ? "✅ Chromium + headless-shell instalados! Agora pode rodar o scraper."
          : `Instalacao parcial: chromium=${status.installed} headless_shell=${status.headless_shell_installed}. Veja output.`,
        isError: !success,
        output,
      })
    );
  } catch (error) {
    const output = `${debugInfo.join("\n")}\n\n=== ERROR ===\n${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`.trim();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(500).send(
      renderHtml({
        message: `Erro ao instalar Chromium: ${error.message}`,
        isError: true,
        output,
      })
    );
  }
}
