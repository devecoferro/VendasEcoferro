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
} from "./seller-center-scraper.js";

const log = createLogger("ml-chip-proxy");

const CACHE_TTL_MS = 60 * 1000;
const SCRAPER_FRESHNESS_MS = 12 * 60 * 60 * 1000; // 12h — alinhado com INJECT_TTL

let chipCountsCache = null;
let lastKnownCounts = null; // ultimo valor conhecido (mesmo stale) — evita pulo UX quando cache expira
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
  // IMPORTANTE: NUNCA dispara scrape sincrono aqui. Scraper leva 30-60s
  // e trava o request do dashboard se for chamado sob demanda. So LE do
  // cache existente (alimentado por background refresh a cada 30s).
  const cached = getCachedLiveSnapshot("all");
  if (!cached) {
    maybeRefreshLiveSnapshotInBackground("all");
    log.info("sem cache scraper — retornando ultimo valor conhecido (ou null)");
    return lastKnownCounts ? { ...lastKnownCounts, stale: true, ageSeconds: null } : null;
  }

  // FIX 2026-05-05: Ignora snapshots de inject manual (extensão Chrome,
  // bookmarklet, sync-from-ml). Esses podem ter valores desatualizados
  // ou capturados com filtro de depósito ativo, poluindo os chips.
  // O classificador OAuth (ml_live_chip_counts) já está correto (max_abs_diff=1).
  const snapSource = cached.data?.source || "unknown";
  if (snapSource === "manual_inject") {
    log.info("snapshot é manual_inject — ignorando (HTTP fetcher é fonte de verdade)");
    return null;
  }

  const snapTs = new Date(
    cached.data?.capturedAt || cached.capturedAt || 0
  ).getTime();
  const ageMs = Date.now() - snapTs;

  if (ageMs > 45_000) {
    maybeRefreshLiveSnapshotInBackground("all");
  }

  const counts = extractCountsFromSnapshot(cached.data);
  if (!counts) {
    return lastKnownCounts ? { ...lastKnownCounts, stale: true, ageSeconds: null } : null;
  }

  // Atualiza lastKnownCounts sempre que temos valor valido (mesmo stale)
  lastKnownCounts = counts;

  const stale = ageMs > SCRAPER_FRESHNESS_MS;
  log.info(stale ? "chips do scraper (stale)" : "chips do scraper (cache)", {
    ...counts,
    ageSeconds: Math.round(ageMs / 1000),
    stale,
  });
  return { ...counts, stale, ageSeconds: Math.round(ageMs / 1000) };
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
