// ─── Upload do storage state do Playwright via browser ────────────────
//
// Substitui a necessidade de SSH/scp/heredoc pra colocar o arquivo
// ml-seller-center-state.json (sessao ML) no volume persistente do
// container. Operador acessa pelo browser, seleciona o arquivo gerado
// pelo `npm run setup:ml-scraper` local, e o endpoint salva no
// $DATA_DIR/playwright/ml-seller-center-state.json.
//
// Endpoints:
//   GET /api/ml/admin/upload-scraper-state       → HTML com <form>
//   POST /api/ml/admin/upload-scraper-state      → recebe upload (JSON)
//
// Auth: requireAdmin (apenas role=admin pode upar).
// Limite: 5MB (storage state do ML costuma ter 30-100KB).
// Validacao: parsea o JSON e confere que tem cookies/origins.

import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../../_lib/auth-server.js";
import { DATA_DIR } from "../../_lib/app-config.js";

const STATE_PATH = path.join(DATA_DIR, "playwright", "ml-seller-center-state.json");
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStatusInfo() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      return { exists: false, size: 0, mtime: null };
    }
    const stat = fs.statSync(STATE_PATH);
    return {
      exists: true,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    };
  } catch {
    return { exists: false, size: 0, mtime: null, error: "stat_failed" };
  }
}

function renderHtml({ message = null, isError = false } = {}) {
  const status = getStatusInfo();
  const statusBlock = status.exists
    ? `<div class="status ok">
         ✅ Storage state já presente — <strong>${status.size}</strong> bytes
         · modificado em ${escapeHtml(status.mtime)}
         <br><small>${escapeHtml(STATE_PATH)}</small>
       </div>`
    : `<div class="status missing">
         ❌ Storage state não encontrado — faça upload abaixo
         <br><small>Caminho: ${escapeHtml(STATE_PATH)}</small>
       </div>`;

  const messageBlock = message
    ? `<div class="message ${isError ? "error" : "success"}">${escapeHtml(message)}</div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Upload — Storage State Playwright (ML scraper)</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#f5f5f7;color:#1a1a1a;padding:24px;max-width:720px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:24px 0 12px;color:#666}
  .meta{color:#666;font-size:13px;margin-bottom:16px}
  .status{padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .status.ok{background:#f0fdf4;border:1px solid #86efac;color:#15803d}
  .status.missing{background:#fff8e1;border:1px solid #fde68a;color:#92400e}
  .message{padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px}
  .message.success{background:#dcfce7;border:1px solid #86efac;color:#15803d}
  .message.error{background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c}
  small{display:block;margin-top:4px;font-family:ui-monospace,monospace;font-size:11px;color:#666}
  form{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px}
  label{display:block;margin-bottom:8px;font-size:13px;color:#333;font-weight:600}
  input[type=file]{display:block;width:100%;padding:8px;border:1px solid #e5e5e5;border-radius:6px;background:#fafafa}
  button{margin-top:16px;background:#3483fa;color:#fff;border:0;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px}
  button:hover{background:#2968c8}
  ol{padding-left:20px;font-size:13px;line-height:1.8}
  code{background:#f0f0f5;padding:2px 6px;border-radius:3px;font-size:12px}
  .next{margin-top:24px;padding:16px;background:#eef4ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px}
  .next a{color:#1e40af;font-weight:600}
</style>
</head>
<body>
  <h1>📤 Upload do Storage State do Playwright</h1>
  <p class="meta">Arquivo de sessão do Mercado Livre Seller Center usado pelo scraper headless.</p>

  ${statusBlock}
  ${messageBlock}

  <h2>Como obter o arquivo</h2>
  <ol>
    <li>Na sua máquina LOCAL, abra o PowerShell na pasta do projeto</li>
    <li>Rode: <code>npm run setup:ml-scraper</code></li>
    <li>Faça login no ML no Chromium que abrir + complete MFA</li>
    <li>Volte no PowerShell e aperte ENTER quando ver os chips</li>
    <li>O arquivo será salvo em: <br><code>data\\playwright\\ml-seller-center-state.json</code></li>
  </ol>

  <h2>Upload do arquivo</h2>
  <form method="POST" action="/api/ml/admin/upload-scraper-state" enctype="multipart/form-data">
    <label for="file">Selecione o arquivo <code>ml-seller-center-state.json</code>:</label>
    <input type="file" id="file" name="state" accept="application/json,.json" required>
    <button type="submit">📤 Fazer upload</button>
  </form>

  <div class="next">
    <strong>Após o upload bem-sucedido, próximo passo:</strong><br>
    Acesse <a href="/api/ml/admin/live-cards-debug?format=html">/api/ml/admin/live-cards-debug</a>
    e clique em "↻ Scrape novo" pra rodar o scraper.
  </div>
</body>
</html>`;
}

// Parser simples de multipart/form-data — evita dependencia em multer pra
// caso especifico de 1 arquivo pequeno. Apenas extrai o primeiro upload.
async function parseMultipartUpload(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data");
  }
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) {
    throw new Error("Missing boundary");
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBytes = Buffer.from(`--${boundary}`);

  // Coleta o body bruto
  const chunks = [];
  let totalSize = 0;
  await new Promise((resolve, reject) => {
    request.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE_BYTES) {
        reject(new Error(`File too large (>${MAX_SIZE_BYTES} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", resolve);
    request.on("error", reject);
  });
  const buffer = Buffer.concat(chunks);

  // Encontra a primeira parte (qualquer arquivo) e extrai o conteudo
  const parts = [];
  let pos = 0;
  while (pos < buffer.length) {
    const start = buffer.indexOf(boundaryBytes, pos);
    if (start < 0) break;
    const headerStart = start + boundaryBytes.length + 2; // skip CRLF
    const headerEnd = buffer.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0) break;
    const headers = buffer.slice(headerStart, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBytes, bodyStart);
    if (nextBoundary < 0) break;
    // -2 pra remover o CRLF antes do proximo boundary
    const body = buffer.slice(bodyStart, nextBoundary - 2);
    parts.push({ headers, body });
    pos = nextBoundary;
  }

  // Procura pela primeira parte que tem filename
  for (const part of parts) {
    if (/filename=/i.test(part.headers)) {
      return { content: part.body, headers: part.headers };
    }
  }
  throw new Error("No file found in upload");
}

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(status).send(
      `<!doctype html><html><body style="font-family:system-ui;padding:24px"><h1>Acesso negado</h1><p>${escapeHtml(error?.message || "")}</p></body></html>`
    );
  }

  if (request.method === "GET") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(renderHtml());
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ success: false, error: "Use GET ou POST." });
  }

  try {
    const { content } = await parseMultipartUpload(request);

    // Valida JSON
    let parsed;
    try {
      parsed = JSON.parse(content.toString("utf8"));
    } catch {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(400).send(
        renderHtml({ message: "Arquivo nao e JSON valido", isError: true })
      );
    }

    // Sanity: storage state tem cookies/origins
    if (!parsed || (!Array.isArray(parsed.cookies) && !Array.isArray(parsed.origins))) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(400).send(
        renderHtml({
          message:
            "JSON valido mas nao parece ser storage state do Playwright (sem cookies/origins).",
          isError: true,
        })
      );
    }

    // Cria diretorio + salva
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, content);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(
      renderHtml({
        message: `✅ Upload OK — ${content.length} bytes salvos. Pode rodar o scraper agora.`,
        isError: false,
      })
    );
  } catch (error) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(500).send(
      renderHtml({ message: `Erro: ${error.message}`, isError: true })
    );
  }
}
