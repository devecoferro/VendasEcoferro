/**
 * Obsidian Local REST API Client
 *
 * Integra o VendasEcoferro com o vault do Obsidian via plugin "Local REST API".
 * CRUD completo: listar, ler, criar, atualizar, deletar e buscar notas.
 *
 * Requer:
 *   - Plugin "Local REST API" ativo no Obsidian (https://127.0.0.1:27124)
 *   - Variáveis OBSIDIAN_API_KEY e OBSIDIAN_BASE_URL no .env
 *
 * @see https://coddingtonbear.github.io/obsidian-local-rest-api/
 */

import createLogger from "./logger.js";

const log = createLogger("obsidian");

// ─── Config ────────────────────────────────────────────────────────
const OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY || "";
const OBSIDIAN_BASE_URL = process.env.OBSIDIAN_BASE_URL || "https://127.0.0.1:27124";

// O plugin usa certificado autoassinado em HTTPS — precisamos desabilitar
// a verificação SSL para chamadas localhost. Isso é seguro porque a
// comunicação é local (127.0.0.1) e protegida pela API Key.
const fetchOptions = {
  headers: {
    Authorization: `Bearer ${OBSIDIAN_API_KEY}`,
  },
};

// Node 18+ com undici: para ignorar SSL autoassinado em localhost
// usamos o agent do node com rejectUnauthorized: false
let customAgent = null;
try {
  const { Agent } = await import("node:https");
  customAgent = new Agent({ rejectUnauthorized: false });
} catch {
  // fallback: se não conseguir criar agent, tenta sem
}

/**
 * Wrapper de fetch para a API do Obsidian.
 * Adiciona auth header e ignora SSL autoassinado.
 */
async function obsidianFetch(path, options = {}) {
  if (!OBSIDIAN_API_KEY) {
    throw new Error("OBSIDIAN_API_KEY não configurada no .env");
  }

  const url = `${OBSIDIAN_BASE_URL}${path}`;
  const config = {
    ...options,
    headers: {
      ...fetchOptions.headers,
      ...options.headers,
    },
  };

  // Node 18+: desabilita verificação SSL para localhost
  if (customAgent && url.startsWith("https://127.0.0.1")) {
    config.agent = customAgent;
  }

  // Node 22+ / undici: usa dispatcher
  // Para versões mais antigas, seta NODE_TLS_REJECT_UNAUTHORIZED=0 no .env
  const response = await fetch(url, config);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Obsidian API ${response.status}: ${body || response.statusText}`);
  }

  return response;
}

// ─── CRUD Operations ───────────────────────────────────────────────

/**
 * S3 do audit: sanitiza path do vault pra prevenir path traversal.
 * Rejeita `..`, paths absolutos (começando com `/`), null bytes e
 * caracteres perigosos. O plugin REST do Obsidian pode seguir `..`
 * e escrever fora do vault.
 */
function sanitizeVaultPath(path) {
  if (typeof path !== "string") {
    throw new Error("Path do vault deve ser string.");
  }
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  // Remove leading "/"
  const cleaned = trimmed.replace(/^\/+/, "");
  // Rejeita traversal
  if (cleaned.includes("..") || cleaned.includes("\0") || cleaned.includes("\r") || cleaned.includes("\n")) {
    throw new Error("Path inválido (traversal ou caracteres perigosos).");
  }
  // Apenas caracteres seguros: letras, números, espaços, _, -, ., /
  if (!/^[A-Za-z0-9 _\-./]+$/.test(cleaned)) {
    throw new Error("Path contém caracteres não permitidos.");
  }
  return cleaned;
}

/**
 * Lista arquivos/pastas em um caminho do vault.
 * @param {string} [vaultPath="/"] - Caminho relativo no vault (ex: "Vendas/2026")
 * @returns {Promise<string[]>} Lista de nomes de arquivos e pastas
 */
export async function listNotes(vaultPath = "/") {
  const safe = sanitizeVaultPath(vaultPath);
  const encodedPath = encodeURIComponent(safe).replace(/%2F/g, "/");
  const res = await obsidianFetch(`/vault/${encodedPath}`);
  const data = await res.json();
  return data.files || data;
}

/**
 * Lê o conteúdo Markdown de uma nota.
 * @param {string} notePath - Caminho da nota (ex: "Vendas/relatorio-abril.md")
 * @returns {Promise<string>} Conteúdo da nota em Markdown
 */
export async function readNote(notePath) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  const res = await obsidianFetch(`/vault/${encodedPath}`, {
    headers: { Accept: "text/markdown" },
  });
  return await res.text();
}

/**
 * Cria ou sobrescreve uma nota.
 * @param {string} notePath - Caminho da nota (ex: "Vendas/nova-nota.md")
 * @param {string} content - Conteúdo Markdown
 * @returns {Promise<boolean>} true se criou com sucesso
 */
export async function createNote(notePath, content) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  await obsidianFetch(`/vault/${encodedPath}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
  log.info(`Nota criada: ${notePath}`);
  return true;
}

/**
 * Anexa conteúdo ao final de uma nota existente.
 * @param {string} notePath - Caminho da nota
 * @param {string} content - Conteúdo a anexar
 * @returns {Promise<boolean>} true se atualizou com sucesso
 */
export async function appendToNote(notePath, content) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  await obsidianFetch(`/vault/${encodedPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/markdown",
      "Content-Insertion-Position": "end",
    },
    body: content,
  });
  log.info(`Conteúdo anexado a: ${notePath}`);
  return true;
}

/**
 * Insere conteúdo no início de uma nota existente.
 * @param {string} notePath - Caminho da nota
 * @param {string} content - Conteúdo a inserir
 * @returns {Promise<boolean>}
 */
export async function prependToNote(notePath, content) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  await obsidianFetch(`/vault/${encodedPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/markdown",
      "Content-Insertion-Position": "beginning",
    },
    body: content,
  });
  log.info(`Conteúdo inserido no início de: ${notePath}`);
  return true;
}

/**
 * Deleta uma nota do vault.
 * @param {string} notePath - Caminho da nota
 * @returns {Promise<boolean>}
 */
export async function deleteNote(notePath) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  await obsidianFetch(`/vault/${encodedPath}`, {
    method: "DELETE",
  });
  log.info(`Nota deletada: ${notePath}`);
  return true;
}

/**
 * Busca notas por texto no vault.
 * @param {string} query - Texto a buscar
 * @returns {Promise<Array<{filename: string, score: number, matches: Array}>>}
 */
export async function searchNotes(query) {
  const res = await obsidianFetch("/search/simple/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return await res.json();
}

/**
 * Verifica se a conexão com o Obsidian está funcionando.
 * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
 */
export async function checkConnection() {
  try {
    const res = await obsidianFetch("/");
    const data = await res.json();
    return {
      ok: data.status === "OK",
      version: data.manifest?.version,
      authenticated: data.authenticated,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Abre uma nota no Obsidian (traz o app pro foco).
 * @param {string} notePath - Caminho da nota
 * @returns {Promise<boolean>}
 */
export async function openNote(notePath) {
  const encodedPath = encodeURIComponent(sanitizeVaultPath(notePath)).replace(/%2F/g, "/");
  await obsidianFetch(`/open/${encodedPath}`, {
    method: "POST",
  });
  return true;
}
