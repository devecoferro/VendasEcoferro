// ═══════════════════════════════════════════════════════════════════
// ML Chip Proxy — alinhamento automatico 1:1 com chips do Seller Center.
//
// FONTE DOS CHIPS (em ordem de prioridade):
// 1. HTTP Fetcher direto (ml-chip-http-fetcher.js) — usa cookies do
//    storage state para chamar /operations-dashboard/tabs via HTTP puro.
//    Sem Playwright, sem browser, <1s de execução, precisão 100%.
// 2. Live Snapshot do scraper Playwright (seller-center-scraper.js) —
//    fallback quando HTTP fetcher não está configurado.
//
// MULTI-CONTA: Suporta connectionId para buscar chips de contas
// diferentes (Ecoferro default, Fantom via connectionId específico).
//
// Cache interno: 60s + dedup de concorrentes.
//
// FIX 2026-05-05: Reescrito para:
// - Usar HTTP fetcher como fonte primária (sem Playwright)
// - Suportar connectionId (multi-conta)
// - Ignorar snapshots de inject manual
// - Manter lastKnownCounts por conexão (evita pulo UX)
// ═══════════════════════════════════════════════════════════════════

import createLogger from "../../_lib/logger.js";
import {
  getCachedLiveSnapshot,
  maybeRefreshLiveSnapshotInBackground,
} from "./seller-center-scraper.js";
import {
  fetchMLChipsViaHTTP,
  isHTTPFetcherConfigured,
} from "./ml-chip-http-fetcher.js";

const log = createLogger("ml-chip-proxy");

const CACHE_TTL_MS = 60 * 1000;
const SCRAPER_FRESHNESS_MS = 12 * 60 * 60 * 1000; // 12h

// Cache e state POR connectionId
const chipCountsCacheByConn = new Map(); // connectionId → { data, expiresAt, capturedAt }
const lastKnownCountsByConn = new Map(); // connectionId → counts
const inflightByConn = new Map(); // connectionId → Promise

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

async function doFetchChips(connectionId = null) {
  const connKey = connectionId || "default";

  // ── FONTE 1: HTTP Fetcher direto (prioridade máxima) ──
  // Usa cookies do storage state para chamar endpoint ML diretamente.
  // Sem Playwright, sem browser, <1s. Precisão 100%.
  if (isHTTPFetcherConfigured(connectionId)) {
    try {
      const httpResult = await fetchMLChipsViaHTTP(connectionId);
      if (httpResult && Number.isFinite(httpResult.today)) {
        const counts = {
          today: httpResult.today,
          upcoming: httpResult.upcoming,
          in_transit: httpResult.in_transit,
          finalized: httpResult.finalized,
        };
        log.info(`[${connKey}] chips via HTTP fetcher`, counts);
        lastKnownCountsByConn.set(connKey, counts);
        return { ...counts, source: "http_fetcher", stale: false, ageSeconds: 0 };
      }
    } catch (err) {
      log.warn(
        `[${connKey}] HTTP fetcher falhou, tentando scraper`,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  // ── FONTE 2: Live Snapshot do scraper Playwright (fallback) ──
  // IMPORTANTE: NUNCA dispara scrape sincrono aqui. Scraper leva 30-60s
  // e trava o request do dashboard. So LE do cache existente.
  const cached = getCachedLiveSnapshot("all", connectionId);
  if (!cached) {
    maybeRefreshLiveSnapshotInBackground("all", connectionId);
    const lastKnown = lastKnownCountsByConn.get(connKey);
    log.info(`[${connKey}] sem cache scraper — retornando ultimo valor conhecido (ou null)`);
    return lastKnown ? { ...lastKnown, stale: true, ageSeconds: null, source: "last_known" } : null;
  }

  // Ignora snapshots de inject manual (podem estar desatualizados)
  const snapSource = cached.data?.source || "unknown";
  if (snapSource === "manual_inject") {
    log.info(`[${connKey}] snapshot é manual_inject — ignorando`);
    const lastKnown = lastKnownCountsByConn.get(connKey);
    return lastKnown ? { ...lastKnown, stale: true, ageSeconds: null, source: "last_known" } : null;
  }

  const snapTs = new Date(
    cached.data?.capturedAt || cached.capturedAt || 0
  ).getTime();
  const ageMs = Date.now() - snapTs;

  if (ageMs > 45_000) {
    maybeRefreshLiveSnapshotInBackground("all", connectionId);
  }

  const counts = extractCountsFromSnapshot(cached.data);
  if (!counts) {
    const lastKnown = lastKnownCountsByConn.get(connKey);
    return lastKnown ? { ...lastKnown, stale: true, ageSeconds: null, source: "last_known" } : null;
  }

  // Atualiza lastKnownCounts
  lastKnownCountsByConn.set(connKey, counts);

  const stale = ageMs > SCRAPER_FRESHNESS_MS;
  log.info(`[${connKey}] chips do scraper (${stale ? "stale" : "fresh"})`, {
    ...counts,
    ageSeconds: Math.round(ageMs / 1000),
  });
  return { ...counts, stale, ageSeconds: Math.round(ageMs / 1000), source: "scraper" };
}

/**
 * Retorna counts oficiais do ML Seller Center.
 * Suporta connectionId para multi-conta.
 * Cache 60s + dedup de concorrentes. Null em erro (fallback local).
 */
export async function fetchMLChipCountsDirect(connectionId = null) {
  const connKey = connectionId || "default";

  // Check cache
  const cached = chipCountsCacheByConn.get(connKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Dedup: evita múltiplas chamadas simultâneas para a mesma conexão
  const inflight = inflightByConn.get(connKey);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const counts = await doFetchChips(connectionId);
      if (counts) {
        chipCountsCacheByConn.set(connKey, {
          data: counts,
          expiresAt: Date.now() + CACHE_TTL_MS,
          capturedAt: new Date().toISOString(),
        });
      }
      return counts;
    } finally {
      inflightByConn.delete(connKey);
    }
  })();

  inflightByConn.set(connKey, promise);
  return promise;
}

/**
 * Retorna chips do cache (sem fetch) para uma conexão.
 */
export function getCachedMLChipCounts(connectionId = null) {
  const connKey = connectionId || "default";
  const cached = chipCountsCacheByConn.get(connKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  return null;
}

/**
 * Invalida cache de uma conexão ou de todas.
 */
export function invalidateMLChipCountsCache(connectionId = null) {
  if (connectionId) {
    chipCountsCacheByConn.delete(connectionId);
  } else {
    chipCountsCacheByConn.clear();
  }
}
