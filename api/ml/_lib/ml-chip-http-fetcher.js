// ═══════════════════════════════════════════════════════════════════
// ML Chip HTTP Fetcher — busca chips DIRETAMENTE do ML Seller Center
// via HTTP usando cookies do storage state (sem Playwright/browser).
//
// COMO FUNCIONA:
// 1. Lê os cookies do storage state do Playwright (arquivo JSON no disco)
// 2. LIMPA cookies desnecessários (evita "Header too large" / HTTP 431)
// 3. Faz fetch HTTP direto para /operations-dashboard/tabs do ML
// 4. Extrai os counters (TAB_TODAY, TAB_NEXT_DAYS, TAB_IN_THE_WAY, TAB_FINISHED)
// 5. Retorna os 4 números exatos que aparecem nos chips do Seller Center
//
// VANTAGENS:
// - Sem Playwright/browser headless (economia de ~250MB RAM)
// - Execução em <1s (vs 30-60s do scraper)
// - Mesma precisão (usa mesmos endpoints internos do ML)
// - Funciona em qualquer servidor (não precisa de Chrome instalado)
// - Suporta múltiplas contas (connectionId)
//
// REQUISITO:
// - Storage state válido com cookies do ML (gerado pelo login manual
//   no Playwright ou via setup-storage-state)
//
// FIX 2026-05-05: Reescrito com:
// - Limpeza agressiva de cookies (só mantém essenciais ML)
// - Suporte a connectionId (multi-conta)
// - Cache por connectionId (isolamento entre contas)
// - Fallback: tenta /operations-dashboard/tabs primeiro, se falhar
//   tenta variante com /api/ no path
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

// Cache interno POR connectionId: 90s (mais fresco que o scraper de 2min)
const CACHE_TTL_MS = 90 * 1000;
const cacheByConnection = new Map(); // connectionId → { data, expiresAt }

// ML Seller Center base URL
const ML_BASE = "https://www.mercadolivre.com.br";

// ═══════════════════════════════════════════════════════════════════
// COOKIE CLEANUP — resolve o problema "Header too large"
// ═══════════════════════════════════════════════════════════════════
// O storage state acumula centenas de cookies ao longo do tempo
// (tracking, analytics, A/B tests, etc). O ML só precisa de ~5-10
// cookies essenciais para autenticação. Mantemos apenas esses.
//
// Cookies essenciais identificados por engenharia reversa:
// - _d2id: device ID (anti-fraud)
// - _ml_ci / _ml_ga: sessão ML
// - _mldataSessionId: sessão de dados
// - D_SID: session ID principal
// - orguseridp: user ID criptografado
// - c_ui-id: UI session
// - _csrf: token CSRF
// - ml-uid: user ID
// - ml-session: sessão principal
// ═══════════════════════════════════════════════════════════════════

// Prefixos/nomes de cookies ESSENCIAIS para autenticação ML.
// Qualquer cookie que NÃO comece com um desses prefixos é descartado.
const ESSENTIAL_COOKIE_PATTERNS = [
  // Sessão e autenticação
  /^_d2id/,
  /^_ml_/,
  /^_mldataSessionId/,
  /^D_SID/,
  /^orguseridp/,
  /^c_ui-id/,
  /^_csrf/,
  /^ml-/,
  /^ssid/,
  /^_s_/,
  // Cookies de sessão genéricos que ML usa
  /^_cp_/,
  /^_cb_/,
  /^_tracking/,
  /^_d_/,
  /^SID_/,
  /^SSID/,
  /^HSID/,
  /^NID/,
  /^secure-/,
  /^_secure/,
];

// Domínios que são relevantes para autenticação ML
const RELEVANT_DOMAINS = [
  ".mercadolivre.com.br",
  ".mercadolibre.com",
  ".ml.com",
  "www.mercadolivre.com.br",
  "mercadolivre.com.br",
];

/**
 * Filtra cookies do storage state mantendo apenas os essenciais.
 * Retorna string de Cookie header com tamanho controlado.
 */
function getCleanCookieHeader(storageState) {
  if (!storageState?.cookies || !Array.isArray(storageState.cookies)) {
    return null;
  }

  // Passo 1: Filtra por domínio relevante
  const mlCookies = storageState.cookies.filter((c) => {
    const domain = c.domain || "";
    return RELEVANT_DOMAINS.some(
      (d) => domain === d || domain.endsWith(d)
    );
  });

  if (mlCookies.length === 0) return null;

  // Passo 2: Se o header resultante for muito grande (>6KB), aplica
  // filtragem mais agressiva mantendo só os essenciais por pattern
  let selectedCookies = mlCookies;
  const fullHeader = mlCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  if (fullHeader.length > 6000) {
    // Filtragem agressiva: só cookies que matcham os patterns essenciais
    selectedCookies = mlCookies.filter((c) =>
      ESSENTIAL_COOKIE_PATTERNS.some((pattern) => pattern.test(c.name))
    );

    // Se ficou vazio demais (< 3 cookies), algo está errado — usa todos
    if (selectedCookies.length < 3) {
      log.warn(
        `Cookie cleanup muito agressivo (${selectedCookies.length} cookies). ` +
        `Usando top 50 por tamanho.`
      );
      // Fallback: pega os 50 menores cookies (evita header gigante)
      selectedCookies = mlCookies
        .sort((a, b) => (a.value?.length || 0) - (b.value?.length || 0))
        .slice(0, 50);
    }
  }

  const header = selectedCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // Log de diagnóstico
  if (fullHeader.length > 6000) {
    log.info(
      `Cookie cleanup: ${mlCookies.length} → ${selectedCookies.length} cookies, ` +
      `header ${fullHeader.length} → ${header.length} bytes`
    );
  }

  // Safety check: se ainda estiver > 12KB, trunca (nginx default max é 8KB)
  if (header.length > 12000) {
    log.warn(`Cookie header ainda muito grande (${header.length} bytes) após cleanup`);
    // Pega só os primeiros 50 cookies por nome mais curto
    const minimal = selectedCookies
      .sort((a, b) => (a.value?.length || 0) - (b.value?.length || 0))
      .slice(0, 30);
    return minimal.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  return header;
}

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
  // Sem fallback ao default — retorna null se não existe per-connection
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

/**
 * Faz fetch de uma tab do operations-dashboard.
 * Retorna o body JSON ou null em caso de erro.
 */
async function fetchTab(tabFilter, cookieHeader, { variant = "default" } = {}) {
  // Duas variantes de URL (o ML às vezes reescreve via nginx/CDN):
  const paths = {
    default: `/sales-omni/packs/marketshops/operations-dashboard/tabs`,
    api: `/sales-omni/api/packs/marketshops/operations-dashboard/tabs`,
  };
  const basePath = paths[variant] || paths.default;

  const url =
    `${ML_BASE}${basePath}` +
    `?sellerSegmentType=professional` +
    `&filters=${encodeURIComponent(tabFilter)}` +
    `&subFilters=` +
    `&store=all` +
    `&gmt=-03:00`;

  const headers = {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "x-scope": "tabs-mlb",
    Cookie: cookieHeader,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: `${ML_BASE}/vendas/omni/lista`,
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual", // Não seguir redirects (indica sessão expirada)
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 431 || res.status === 494) {
      // 431 = Request Header Fields Too Large
      // 494 = nginx Request Header Too Large
      log.warn(`Tab ${tabFilter} (${variant}): HTTP ${res.status} — header too large (cookies?)`);
      return { error: "header_too_large", status: res.status };
    }

    if (res.status >= 300 && res.status < 400) {
      log.warn(`Tab ${tabFilter} (${variant}): redirect ${res.status} (sessão expirada?)`);
      return { error: "session_expired", status: res.status };
    }

    if (res.status === 404) {
      // 404 pode ser causado por header too large (ML retorna 404 em vez de 431)
      log.warn(`Tab ${tabFilter} (${variant}): HTTP 404 — possível header too large ou endpoint mudou`);
      return { error: "not_found", status: 404 };
    }

    if (!res.ok) {
      log.warn(`Tab ${tabFilter} (${variant}): HTTP ${res.status}`);
      return { error: "http_error", status: res.status };
    }

    const text = await res.text();
    try {
      return { ok: true, body: JSON.parse(text) };
    } catch {
      log.warn(`Tab ${tabFilter} (${variant}): resposta não é JSON (${text.slice(0, 200)})`);
      return { error: "not_json", status: res.status };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      log.warn(`Tab ${tabFilter} (${variant}): timeout (15s)`);
      return { error: "timeout" };
    }
    log.warn(`Tab ${tabFilter} (${variant}): fetch error — ${msg}`);
    return { error: "network", message: msg };
  }
}

/**
 * Extrai counters de um response body do operations-dashboard/tabs.
 * O ML retorna um array de "bricks", e dentro de um deles há um
 * brick com id="segmented_actions_marketshops" que contém os segments
 * com os counts de cada tab.
 */
function extractCountersFromBody(body) {
  if (!body) return null;

  const counters = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
  let found = false;

  // DFS no body para encontrar segmented_actions_marketshops
  const stack = [body];
  const maxIter = 50000; // safety: evita loop infinito em payloads enormes
  let iter = 0;
  while (stack.length && iter++ < maxIter) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;

    if (cur.id === "segmented_actions_marketshops" && cur.data?.segments) {
      found = true;
      for (const seg of cur.data.segments) {
        const count = parseInt(String(seg.count || "0"), 10) || 0;
        if (seg.id === "TAB_TODAY" && count > counters.today) counters.today = count;
        else if (seg.id === "TAB_NEXT_DAYS" && count > counters.upcoming) counters.upcoming = count;
        else if (seg.id === "TAB_IN_THE_WAY" && count > counters.in_transit) counters.in_transit = count;
        else if (seg.id === "TAB_FINISHED" && count > counters.finalized) counters.finalized = count;
      }
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

/**
 * Busca os chips do ML Seller Center via HTTP direto.
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

  // Get clean cookie header (evita "Header too large")
  const cookieHeader = getCleanCookieHeader(storageState);
  if (!cookieHeader) {
    log.warn(`Nenhum cookie ML válido para connection=${cacheKey}`);
    return null;
  }

  log.info(`Buscando chips via HTTP para connection=${cacheKey} (cookie header: ${cookieHeader.length} bytes)`);

  // Estratégia: faz fetch de UMA tab (qualquer uma retorna os counts de TODAS).
  // Se falhar com a variante default, tenta a variante /api/.
  // Se ambas falharem, tenta com a segunda tab como fallback.
  const TAB_FILTERS = ["TAB_TODAY", "TAB_NEXT_DAYS", "TAB_IN_THE_WAY", "TAB_FINISHED"];

  let counters = null;
  let lastError = null;

  // Tenta variante "default" com TAB_TODAY
  const result1 = await fetchTab("TAB_TODAY", cookieHeader, { variant: "default" });
  if (result1?.ok) {
    counters = extractCountersFromBody(result1.body);
  } else {
    lastError = result1?.error;
  }

  // Se não conseguiu, tenta variante "api"
  if (!counters) {
    const result2 = await fetchTab("TAB_TODAY", cookieHeader, { variant: "api" });
    if (result2?.ok) {
      counters = extractCountersFromBody(result2.body);
    } else {
      lastError = result2?.error || lastError;
    }
  }

  // Se ainda não conseguiu, tenta TODAS as tabs em paralelo (cada uma
  // retorna os counts de todas — pegamos o maior por tab)
  if (!counters) {
    const results = await Promise.all(
      TAB_FILTERS.map((tab) => fetchTab(tab, cookieHeader, { variant: "default" }))
    );

    const aggregated = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
    let anySuccess = false;

    for (const r of results) {
      if (!r?.ok) continue;
      const c = extractCountersFromBody(r.body);
      if (c) {
        anySuccess = true;
        if (c.today > aggregated.today) aggregated.today = c.today;
        if (c.upcoming > aggregated.upcoming) aggregated.upcoming = c.upcoming;
        if (c.in_transit > aggregated.in_transit) aggregated.in_transit = c.in_transit;
        if (c.finalized > aggregated.finalized) aggregated.finalized = c.finalized;
      }
    }

    if (anySuccess) counters = aggregated;
  }

  if (!counters) {
    log.warn(`HTTP fetcher falhou para connection=${cacheKey}: ${lastError || "unknown"}`);
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
