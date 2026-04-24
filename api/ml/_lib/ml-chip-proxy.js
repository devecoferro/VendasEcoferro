// ═══════════════════════════════════════════════════════════════════
// ML Chip Proxy — chama o endpoint OFICIAL do ML Seller Center que
// alimenta os chips do header (Envios de hoje / Proximos dias / Em
// transito / Finalizadas) e retorna os counts 1:1.
//
// Endpoint interno ML (descoberto via engenharia reversa 2026-04-23):
//   GET /sales-omni/packs/marketshops/operations-dashboard/tabs
//   Header: x-scope: tabs-mlb
//   Acessado via proxy wrapper: POST /vendas/omni/lista/api/channels/event-request
//   Requer: cookies de sessao ML (do storage state) + CSRF token
//
// Cache: 30s (mesmo TTL do live snapshot do scraper).
// Se falhar (sessao expirada, rate limit, etc), retorna null e o caller
// faz fallback pra logica local de classificacao.
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import createLogger from "../../_lib/logger.js";
import { DATA_DIR } from "../../_lib/app-config.js";

const log = createLogger("ml-chip-proxy");

const CACHE_TTL_MS = 30 * 1000;
const STORAGE_STATE_PATH =
  process.env.ML_SCRAPER_STORAGE_STATE_PATH ||
  path.join(DATA_DIR, "playwright", "ml-seller-center-state.json");

let chipCountsCache = null;

// Lazy load playwright (ja usado pelo scraper)
async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    return mod.chromium || mod.default?.chromium;
  } catch {
    return null;
  }
}

function hasStorageState() {
  try {
    return fs.existsSync(STORAGE_STATE_PATH) &&
      fs.statSync(STORAGE_STATE_PATH).size > 0;
  } catch {
    return false;
  }
}

/**
 * Chama o endpoint de chips do ML Seller Center via proxy wrapper.
 * Retorna { today, upcoming, in_transit, finalized } ou null em erro.
 */
export async function fetchMLChipCountsDirect() {
  // Cache hit
  if (chipCountsCache && chipCountsCache.expiresAt > Date.now()) {
    return chipCountsCache.data;
  }

  if (!hasStorageState()) {
    log.warn("storage state ML nao encontrado — skip chip proxy");
    return null;
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    log.error("playwright nao disponivel");
    return null;
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-first-run",
      ],
    });
    const ctx = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    const page = await ctx.newPage();

    // Navega pra pagina pra que CSRF token seja extraido do HTML
    await page.goto(
      "https://www.mercadolivre.com.br/vendas/omni/lista?filters=TAB_TODAY",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(2000);

    const html = await page.content();
    const csrfMatch = html.match(/csrfToken[\"']?\s*:\s*[\"']([^\"']+)/);
    const csrf = csrfMatch ? csrfMatch[1] : null;
    if (!csrf) {
      log.warn("CSRF token nao extraido do HTML");
      return null;
    }

    const requestBody = {
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
    };

    const r = await page.request.post(
      "https://www.mercadolivre.com.br/vendas/omni/lista/api/channels/event-request",
      {
        data: requestBody,
        headers: {
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest",
          "x-csrf-token": csrf,
          "csrf-token": csrf,
        },
      }
    );

    if (!r.ok()) {
      log.warn("endpoint chip retornou nao-OK", {
        status: r.status(),
      });
      return null;
    }

    const json = await r.json();
    const segments = json?.response?.["0"]?.data?.bricks?.[0]?.data?.segments;
    if (!Array.isArray(segments)) {
      log.warn("formato inesperado da resposta");
      return null;
    }

    const counts = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
    for (const seg of segments) {
      const count = Number(seg.count || 0);
      if (Number.isNaN(count)) continue;
      if (seg.id === "TAB_TODAY") counts.today = count;
      else if (seg.id === "TAB_NEXT_DAYS") counts.upcoming = count;
      else if (seg.id === "TAB_IN_THE_WAY") counts.in_transit = count;
      else if (seg.id === "TAB_FINISHED") counts.finalized = count;
    }

    chipCountsCache = {
      data: counts,
      expiresAt: Date.now() + CACHE_TTL_MS,
      capturedAt: new Date().toISOString(),
    };

    log.info("chips do ML direto", counts);
    return counts;
  } catch (err) {
    log.error(
      "falha ao buscar chips do ML",
      err instanceof Error ? err : new Error(String(err))
    );
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* silent */
      }
    }
  }
}

/**
 * Retorna o ultimo cache valido sem disparar nova chamada.
 */
export function getCachedMLChipCounts() {
  if (chipCountsCache && chipCountsCache.expiresAt > Date.now()) {
    return chipCountsCache.data;
  }
  return null;
}
