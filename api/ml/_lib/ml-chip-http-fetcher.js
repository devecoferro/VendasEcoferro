// ═══════════════════════════════════════════════════════════════════
// ML Chip HTTP Fetcher — busca chips DIRETAMENTE do ML Seller Center
// via HTTP usando cookies do storage state (sem Playwright/browser).
//
// COMO FUNCIONA:
// 1. Lê os cookies do storage state do Playwright (arquivo JSON no disco)
// 2. Faz fetch HTTP direto para /operations-dashboard/tabs do ML
// 3. Extrai os counters (TAB_TODAY, TAB_NEXT_DAYS, TAB_IN_THE_WAY, TAB_FINISHED)
// 4. Retorna os 4 números exatos que aparecem nos chips do Seller Center
//
// VANTAGENS:
// - Sem Playwright/browser headless (economia de ~250MB RAM)
// - Execução em <1s (vs 30-60s do scraper)
// - Mesma precisão (usa mesmos endpoints internos do ML)
// - Funciona em qualquer servidor (não precisa de Chrome instalado)
//
// REQUISITO:
// - Storage state válido com cookies do ML (gerado pelo login manual
//   no Playwright ou via setup-storage-state)
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

// Cache interno: 60s
const CACHE_TTL_MS = 60 * 1000;
let cache = null; // { data, expiresAt }

// ML Seller Center base URL
const ML_BASE = "https://www.mercadolivre.com.br";

// Tabs que queremos buscar (cada uma retorna o count de TODAS as tabs)
const TAB_FILTERS = ["TAB_TODAY", "TAB_NEXT_DAYS", "TAB_IN_THE_WAY", "TAB_FINISHED"];

/**
 * Extrai cookies do storage state e formata como header Cookie.
 */
function getCookieHeader(storageState) {
  if (!storageState?.cookies || !Array.isArray(storageState.cookies)) {
    return null;
  }
  // Filtra cookies do domínio mercadolivre/mercadolibre
  const mlCookies = storageState.cookies.filter(
    (c) =>
      c.domain?.includes("mercadolivre") ||
      c.domain?.includes("mercadolibre") ||
      c.domain?.includes(".ml.com")
  );
  if (mlCookies.length === 0) return null;
  return mlCookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Faz fetch de uma tab do operations-dashboard.
 * Retorna o body JSON ou null em caso de erro.
 */
async function fetchTab(tabFilter, cookieHeader, csrfToken = null) {
  const url =
    `${ML_BASE}/sales-omni/packs/marketshops/operations-dashboard/tabs` +
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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: `${ML_BASE}/vendas/omni/lista`,
  };
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual", // Não seguir redirects (indica sessão expirada)
    });

    if (res.status >= 300 && res.status < 400) {
      log.warn(`Tab ${tabFilter}: redirect (sessão expirada?), status=${res.status}`);
      return null;
    }
    if (!res.ok) {
      log.warn(`Tab ${tabFilter}: HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      log.warn(`Tab ${tabFilter}: resposta não é JSON (${text.slice(0, 200)})`);
      return null;
    }
  } catch (err) {
    log.warn(`Tab ${tabFilter}: fetch error`, err instanceof Error ? err : new Error(String(err)));
    return null;
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
  while (stack.length) {
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
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  return found ? counters : null;
}

/**
 * Busca os chips do ML Seller Center via HTTP direto.
 * Retorna { today, upcoming, in_transit, finalized } ou null em caso de erro.
 */
export async function fetchMLChipsViaHTTP(connectionId = null) {
  // Check cache
  if (cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  // Resolve storage state path
  let statePath = STORAGE_STATE_PATH;
  if (connectionId) {
    const perConnPath = STORAGE_STATE_PATH.replace(
      /\.json$/,
      `-${connectionId}.json`
    );
    if (fs.existsSync(perConnPath)) {
      statePath = perConnPath;
    }
  }

  // Load storage state
  let storageState;
  try {
    if (!fs.existsSync(statePath)) {
      log.warn(`Storage state não encontrado: ${statePath}`);
      return null;
    }
    const raw = fs.readFileSync(statePath, "utf8");
    storageState = JSON.parse(raw);
  } catch (err) {
    log.warn("Erro ao ler storage state", err instanceof Error ? err : new Error(String(err)));
    return null;
  }

  const cookieHeader = getCookieHeader(storageState);
  if (!cookieHeader) {
    log.warn("Nenhum cookie ML encontrado no storage state");
    return null;
  }

  // Busca todas as 4 tabs em paralelo (cada uma retorna os counts de TODAS as tabs)
  // Pegamos o MAIOR count por tab (mesma lógica do scraper)
  const results = await Promise.all(
    TAB_FILTERS.map((tab) => fetchTab(tab, cookieHeader))
  );

  const aggregated = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
  let anySuccess = false;

  for (const body of results) {
    const counters = extractCountersFromBody(body);
    if (counters) {
      anySuccess = true;
      if (counters.today > aggregated.today) aggregated.today = counters.today;
      if (counters.upcoming > aggregated.upcoming) aggregated.upcoming = counters.upcoming;
      if (counters.in_transit > aggregated.in_transit) aggregated.in_transit = counters.in_transit;
      if (counters.finalized > aggregated.finalized) aggregated.finalized = counters.finalized;
    }
  }

  if (!anySuccess) {
    log.warn("Nenhuma tab retornou counters válidos (sessão expirada?)");
    return null;
  }

  log.info("Chips obtidos via HTTP direto", aggregated);

  // Cache
  cache = {
    data: aggregated,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return aggregated;
}

/**
 * Invalida o cache do fetcher.
 */
export function invalidateHTTPChipCache() {
  cache = null;
}
