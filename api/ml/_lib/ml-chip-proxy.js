// ═══════════════════════════════════════════════════════════════════
// ML Chip Proxy — alinhamento automatico 1:1 com chips do Seller Center.
//
// FONTE DOS CHIPS: usa o SCRAPER do Seller Center (seller-center-scraper.js)
// que ja roda periodicamente em background e captura os counters dos
// XHRs internos do ML via navegacao nas 4 tabs. O campo snap.counters
// tem os 4 numeros exatos que o user ve no topo do Seller Center.
//
// DESCOBERTA DA ENGENHARIA REVERSA (2026-04-23 a 24):
// - Endpoint /operations-dashboard/tabs existe mas retorna counts
//   que dependem do parametro `filters` enviado e nao sao estaveis.
// - O scraper do Seller Center navega em cada tab e agrega os
//   counters de TODOS os XHRs (pegando o maior por segment) — essa
//   agregacao bate 1:1 com os chips visuais.
// - Esse scraper ja roda em background a cada 30s, entao o cache
//   dele (2 min TTL) quase sempre tem valores atualizados.
//
// Estrategia aqui:
//   1. Primeiro: tentar snapshot do scraper (cache ou refresh sob demanda)
//   2. Fail-open: se scraper falhar, retorna null → fallback classifier
//
// Cache interno: 60s (balancea entre frescura e custo).
// ═══════════════════════════════════════════════════════════════════

import createLogger from "../../_lib/logger.js";
import {
  getCachedLiveSnapshot,
  maybeRefreshLiveSnapshotInBackground,
  scrapeMlLiveSnapshot,
} from "./seller-center-scraper.js";

const log = createLogger("ml-chip-proxy");

const CACHE_TTL_MS = 60 * 1000;
const SCRAPER_FRESHNESS_MS = 3 * 60 * 1000; // aceita cache do scraper ate 3min

let chipCountsCache = null;
let inflightPromise = null;

function extractCountsFromSnapshot(snap) {
  if (!snap || typeof snap !== "object") return null;
  const counters = snap.counters || snap.data?.counters;
  if (!counters) return null;
  const today = Number(counters.today || 0);
  const upcoming = Number(counters.upcoming || 0);
  const in_transit = Number(counters.in_transit || 0);
  const finalized = Number(counters.finalized || 0);
  if (![today, upcoming, in_transit, finalized].every(Number.isFinite)) {
    return null;
  }
  // Sanity check: se todos zerados, provavelmente snapshot ainda nao capturou
  if (today === 0 && upcoming === 0 && in_transit === 0 && finalized === 0) {
    return null;
  }
  return { today, upcoming, in_transit, finalized };
}

async function doFetchChips() {
  // 1. Tenta cache fresh do scraper (atualizado < 3min)
  const cached = getCachedLiveSnapshot("all");
  if (cached && !cached.stale && cached.data) {
    const snapTs = new Date(
      cached.data?.capturedAt || cached.capturedAt || 0
    ).getTime();
    if (Date.now() - snapTs < SCRAPER_FRESHNESS_MS) {
      const counts = extractCountsFromSnapshot(cached.data);
      if (counts) {
        log.info("chips do scraper (cache fresco)", counts);
        // Dispara refresh em background pra proxima chamada ja ter dados novos
        maybeRefreshLiveSnapshotInBackground("all");
        return counts;
      }
    }
  }

  // 2. Cache stale ou ausente — dispara scrape sincrono
  log.info("cache scraper ausente/stale — scraping sob demanda");
  try {
    const snap = await scrapeMlLiveSnapshot({ scope: "all" });
    const counts = extractCountsFromSnapshot(snap);
    if (counts) {
      log.info("chips do scraper (recem capturado)", counts);
      return counts;
    }
    log.warn("scraper retornou mas counters vazios/invalidos", {
      hasSnap: !!snap,
      counters: snap?.counters,
    });
    return null;
  } catch (err) {
    log.error(
      "falha ao scraper pra chips",
      err instanceof Error ? err : new Error(String(err))
    );
    return null;
  }
}

/**
 * Retorna counts oficiais do ML Seller Center (via scraper).
 * Cache 60s + dedup de concorrentes. Null em erro (fallback local).
 */
export async function fetchMLChipCountsDirect() {
  if (chipCountsCache && chipCountsCache.expiresAt > Date.now()) {
    return chipCountsCache.data;
  }

  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const counts = await doFetchChips();
      if (counts) {
        chipCountsCache = {
          data: counts,
          expiresAt: Date.now() + CACHE_TTL_MS,
          capturedAt: new Date().toISOString(),
        };
      }
      return counts;
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

export function getCachedMLChipCounts() {
  if (chipCountsCache && chipCountsCache.expiresAt > Date.now()) {
    return chipCountsCache.data;
  }
  return null;
}

export function invalidateMLChipCountsCache() {
  chipCountsCache = null;
}
