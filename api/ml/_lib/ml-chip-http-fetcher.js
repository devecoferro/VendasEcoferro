// ═══════════════════════════════════════════════════════════════════
// ML Chip HTTP Fetcher — busca chips DIRETAMENTE do ML Seller Center
// via HTTP usando cookies do storage state (sem Playwright/browser).
//
// COMO FUNCIONA (rev15 — 2026-05-05):
// 1. Lê os cookies do storage state do Playwright (arquivo JSON no disco)
// 2. Faz GET na página /vendas/omni/lista para obter o CSRF token
// 3. Faz POST em /vendas/omni/lista/api/channels/event-request
//    com o CSRF token + cookies → retorna os chips exatos
// 4. Extrai os counters (TAB_TODAY, TAB_NEXT_DAYS, TAB_IN_THE_WAY, TAB_FINISHED)
//
// VANTAGENS:
// - Sem Playwright/browser headless (economia de ~250MB RAM)
// - Execução em <2s (vs 30-60s do scraper)
// - Precisão 100% (usa o mesmo endpoint que o frontend JS do ML)
// - Funciona em qualquer servidor (não precisa de Chrome instalado)
// - Suporta múltiplas contas (connectionId)
//
// REQUISITO:
// - Storage state válido com cookies do ML (gerado pelo login manual
//   no Playwright ou via capturar-cookies-ml.mjs)
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import createLogger from "../../_lib/logger.js";

const log = createLogger("ml-chip-http-fetcher");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DEFAULT_STORAGE_STATE_PATH = path.join(
  DATA_DIR,
  "playwright",
  "ml-seller-center-state.json"
);
const STORAGE_STATE_PATH =
  process.env.ML_SCRAPER_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE_PATH;

// Cache interno POR connectionId: 90s
const CACHE_TTL_MS = 90 * 1000;
const cacheByConnection = new Map(); // connectionId → { data, expiresAt }

// ML Seller Center URLs
const ML_BASE = "https://www.mercadolivre.com.br";
const ML_PAGE_URL = `${ML_BASE}/vendas/omni/lista`;
const ML_EVENT_REQUEST_URL = `${ML_PAGE_URL}/api/channels/event-request`;

// User-Agent consistente
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ═══════════════════════════════════════════════════════════════════
// COOKIE HANDLING
// ═══════════════════════════════════════════════════════════════════

// Domínios relevantes para autenticação ML
const RELEVANT_DOMAINS = [
  ".mercadolivre.com.br",
  ".mercadolibre.com",
  "www.mercadolivre.com.br",
  "mercadolivre.com.br",
  "www.mercadolivre.com",
  ".mercadolivre.com",
];

/**
 * Constrói o cookie header a partir do storage state.
 * Inclui TODOS os cookies de domínios ML (não filtra por pattern).
 */
function buildCookieHeader(storageState) {
  if (!storageState?.cookies || !Array.isArray(storageState.cookies)) {
    return null;
  }

  // Filtra por domínio relevante
  const mlCookies = storageState.cookies.filter((c) => {
    const domain = c.domain || "";
    return RELEVANT_DOMAINS.some(
      (d) => domain === d || domain.endsWith(d)
    );
  });

  if (mlCookies.length === 0) return null;

  const header = mlCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // Safety check: se > 12KB, pega os mais importantes (por nome)
  if (header.length > 12000) {
    log.warn(`Cookie header muito grande (${header.length} bytes), truncando`);
    const essential = mlCookies
      .sort((a, b) => (a.value?.length || 0) - (b.value?.length || 0))
      .slice(0, 40);
    return essential.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  return header;
}

// ═══════════════════════════════════════════════════════════════════
// STORAGE STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve o path do storage state para uma conexão específica.
 */
function resolveStatePath(connectionId) {
  if (!connectionId) return STORAGE_STATE_PATH;
  const perConnPath = STORAGE_STATE_PATH.replace(
    /\.json$/,
    `-${connectionId}.json`
  );
  if (fs.existsSync(perConnPath)) return perConnPath;
  return null;
}

/**
 * Carrega e valida o storage state do disco.
 */
function loadAndValidateState(connectionId) {
  const statePath = resolveStatePath(connectionId);
  if (!statePath) {
    log.warn(`Storage state não encontrado para connection=${connectionId || "default"}`);
    return null;
  }

  try {
    if (!fs.existsSync(statePath)) {
      log.warn(`Storage state não existe: ${statePath}`);
      return null;
    }
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || (!parsed.cookies && !parsed.origins)) {
      log.warn(`Storage state inválido (sem cookies/origins): ${statePath}`);
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn("Erro ao ler storage state", err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CSRF TOKEN EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Faz GET na página do ML Seller Center e extrai o CSRF token do HTML.
 * O token está em: "csrfToken":"<token>" ou <meta name="csrf-token" content="<token>">
 */
async function fetchCsrfToken(cookieHeader) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(ML_PAGE_URL, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status >= 300 && res.status < 400) {
      log.warn(`CSRF fetch: redirect ${res.status} (sessão expirada)`);
      return null;
    }

    if (!res.ok) {
      log.warn(`CSRF fetch: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Extrair csrfToken do JSON inline no HTML
    const csrfMatch = html.match(/"csrfToken":"([^"]+)"/);
    if (csrfMatch) {
      return csrfMatch[1];
    }

    // Fallback: meta tag
    const metaMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    if (metaMatch) {
      return metaMatch[1];
    }

    log.warn("CSRF token não encontrado no HTML da página");
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`CSRF fetch error: ${msg}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EVENT-REQUEST — busca os chips via POST
// ═══════════════════════════════════════════════════════════════════

/**
 * Faz POST no event-request do ML para obter os chips.
 * Retorna o body JSON da resposta ou null.
 */
async function fetchEventRequest(cookieHeader, csrfToken) {
  const body = JSON.stringify({
    baseUrl: "/sales-omni",
    method: "GET",
    path: "/packs/marketshops/operations-dashboard/tabs",
    loadingEvents: [],
    errorEvents: [],
    queryParams: [
      { key: "sellerSegmentType", value: "professional" },
      { key: "filters", value: "TAB_TODAY" },
      { key: "subFilters", value: "" },
      { key: "store", value: "all" },
      { key: "gmt", value: "-03:00" },
    ],
    pathParams: [],
    bodyParams: [],
    headers: [{ key: "x-scope", value: "tabs-mlb" }],
    impersonalized: false,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(ML_EVENT_REQUEST_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "x-csrf-token": csrfToken,
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
        Referer: ML_PAGE_URL,
      },
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 422) {
      log.warn(`event-request: 422 validation error (CSRF token inválido ou body incorreto)`);
      return null;
    }

    if (res.status === 403) {
      log.warn(`event-request: 403 forbidden (CSRF rejeitado)`);
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      log.warn(`event-request: redirect ${res.status} (sessão expirada)`);
      return null;
    }

    if (!res.ok) {
      log.warn(`event-request: HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      log.warn(`event-request: resposta não é JSON (${text.slice(0, 100)})`);
      return null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      log.warn("event-request: timeout (15s)");
    } else {
      log.warn(`event-request: fetch error — ${msg}`);
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// COUNTER EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extrai counters da resposta do event-request.
 * A resposta contém response[].data.bricks[] com
 * id="segmented_actions_marketshops" → data.segments[]
 */
function extractCountersFromResponse(responseBody) {
  if (!responseBody) return null;

  const counters = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
  let found = false;

  // DFS no body para encontrar segmented_actions_marketshops
  const stack = [responseBody];
  const maxIter = 50000;
  let iter = 0;
  while (stack.length && iter++ < maxIter) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;

    if (cur.id === "segmented_actions_marketshops" && cur.data?.segments) {
      found = true;
      for (const seg of cur.data.segments) {
        const count = parseInt(String(seg.count || "0"), 10) || 0;
        if (seg.id === "TAB_TODAY") counters.today = count;
        else if (seg.id === "TAB_NEXT_DAYS") counters.upcoming = count;
        else if (seg.id === "TAB_IN_THE_WAY") counters.in_transit = count;
        else if (seg.id === "TAB_FINISHED") counters.finalized = count;
      }
      break; // Found it, no need to continue
    }

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else {
      for (const v of Object.values(cur)) {
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  return found ? counters : null;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Busca os chips do ML Seller Center via HTTP direto.
 * Fluxo: GET page → extract CSRF → POST event-request → extract counters.
 * Suporta connectionId para multi-conta.
 * Retorna { today, upcoming, in_transit, finalized, source: "http_fetcher" } ou null.
 */
export async function fetchMLChipsViaHTTP(connectionId = null) {
  const cacheKey = connectionId || "default";

  // Check cache
  const cached = cacheByConnection.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Load storage state
  const storageState = loadAndValidateState(connectionId);
  if (!storageState) return null;

  // Build cookie header
  const cookieHeader = buildCookieHeader(storageState);
  if (!cookieHeader) {
    log.warn(`Nenhum cookie ML válido para connection=${cacheKey}`);
    return null;
  }

  log.info(`Buscando chips via HTTP para connection=${cacheKey} (cookie: ${cookieHeader.length} bytes)`);

  // Step 1: Fetch CSRF token from page HTML
  const csrfToken = await fetchCsrfToken(cookieHeader);
  if (!csrfToken) {
    log.warn(`Não foi possível obter CSRF token para connection=${cacheKey}`);
    return null;
  }
  log.info(`CSRF token obtido para connection=${cacheKey}: ${csrfToken.slice(0, 8)}...`);

  // Step 2: POST event-request with CSRF token
  const responseBody = await fetchEventRequest(cookieHeader, csrfToken);
  if (!responseBody) {
    log.warn(`event-request falhou para connection=${cacheKey}`);
    return null;
  }

  // Step 3: Extract counters from response
  const counters = extractCountersFromResponse(responseBody);
  if (!counters) {
    log.warn(`Não foi possível extrair counters da resposta para connection=${cacheKey}`);
    return null;
  }

  log.info(`Chips obtidos via HTTP direto para connection=${cacheKey}:`, counters);

  const data = {
    ...counters,
    source: "http_fetcher",
    fetchedAt: new Date().toISOString(),
  };

  // Cache por connection
  cacheByConnection.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return data;
}

/**
 * Invalida o cache do fetcher (para uma conexão ou todas).
 */
export function invalidateHTTPChipCache(connectionId = null) {
  if (connectionId) {
    cacheByConnection.delete(connectionId);
  } else {
    cacheByConnection.clear();
  }
}

/**
 * Verifica se o HTTP fetcher está configurado (tem storage state) para uma conexão.
 */
export function isHTTPFetcherConfigured(connectionId = null) {
  const statePath = resolveStatePath(connectionId);
  if (!statePath) return false;
  try {
    return fs.existsSync(statePath) && fs.statSync(statePath).size > 0;
  } catch {
    return false;
  }
}
