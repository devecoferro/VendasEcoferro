// ═══════════════════════════════════════════════════════════════════
// Scrape Telemetry — registro persistente de cada execucao do scraper
// do Seller Center, com auto-deteccao de drift de XHR.
//
// MOTIVACAO: o scraper interno depende de XHRs especificos do ML pra
// extrair counters/orders. Quando o ML muda essa estrutura (ja aconteceu
// 4x esse mes), o scraper continua "funcionando" tecnicamente mas
// retorna dados zerados sem alertar. Esta telemetria detecta isso
// comparando assinaturas de XHRs entre runs e alerta no log.
//
// Uso:
//   recordScrapeHistory({ scope, ok, counters, total_orders, xhr_count,
//                          detected_store_ids, elapsed_ms, error, triggered_by });
//   const drift = detectXhrDrift(scope);
//   if (drift.has_drift) { ...alert... }
//
// Schema: ver migrations/20260424_add_ml_scrape_history.sql
// ═══════════════════════════════════════════════════════════════════

import { db } from "./db.js";
import createLogger from "./logger.js";

const log = createLogger("scrape-telemetry");

const KNOWN_ML_PATH_PATTERNS = [
  // Patterns conhecidos. Auto-deteccao alerta quando algum deixa de
  // aparecer OU um novo apareceu nos ultimos N runs.
  /\/sales-omni\/packs\/marketshops\/operations-dashboard\/tabs/,
  /\/sales-omni\/packs\/marketshops\/list/,
  /\/api\/channels\/event-request/,
  /\/operations-dashboard\/actions/,
];

function extractXhrSignatures(rawSnapshot) {
  // Snapshot pode vir do scrapeMlLiveSnapshot OU do scrapeMlSellerCenterFull.
  // Ambos tem `tabs[tabKey][storeKey].xhr_responses` com URL de cada XHR.
  const sigs = new Set();
  const tabs = rawSnapshot?.tabs || rawSnapshot?.data?.tabs;
  if (tabs && typeof tabs === "object") {
    for (const tab of Object.values(tabs)) {
      if (!tab || typeof tab !== "object") continue;
      for (const store of Object.values(tab)) {
        const xhrs = store?.xhr_responses || [];
        for (const xhr of xhrs) {
          if (xhr?.url) {
            try {
              const u = new URL(xhr.url);
              sigs.add(u.pathname);
            } catch {
              // url malformada — ignora
            }
          }
        }
      }
    }
  }
  return Array.from(sigs).sort();
}

function jsonStringifySafe(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function jsonParseSafe(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Prepared statements cacheados (better-sqlite3 prepare é caro pra fazer toda
// chamada). Padrao usado em outras libs do repo (audit-log.js).
let stmtInsert = null;
let stmtSelectByScope = null;
let stmtPrune = null;

function getStmtInsert() {
  if (!stmtInsert) {
    stmtInsert = db.prepare(`
      INSERT INTO ml_scrape_history (
        captured_at, scope, ok, counters_json, total_orders, xhr_count,
        detected_store_ids_json, xhr_signatures_json, elapsed_ms, error,
        triggered_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }
  return stmtInsert;
}

function getStmtSelectByScope() {
  if (!stmtSelectByScope) {
    stmtSelectByScope = db.prepare(
      `SELECT id, captured_at, ok, xhr_signatures_json
       FROM ml_scrape_history
       WHERE scope = ? AND ok = 1
       ORDER BY captured_at DESC
       LIMIT ?`
    );
  }
  return stmtSelectByScope;
}

function getStmtPrune() {
  if (!stmtPrune) {
    stmtPrune = db.prepare(`DELETE FROM ml_scrape_history WHERE captured_at < ?`);
  }
  return stmtPrune;
}

/**
 * Grava 1 linha em ml_scrape_history.
 *
 * @param {object} params
 * @param {string} params.scope                  - "all" | "without_deposit" | "full" | "ourinhos"
 * @param {boolean} params.ok                    - sucesso ou falha
 * @param {object|null} params.counters          - { today, upcoming, in_transit, finalized }
 * @param {number} [params.total_orders]
 * @param {number} [params.xhr_count]
 * @param {string[]} [params.detected_store_ids]
 * @param {string[]} [params.xhr_signatures]     - paths unicos de XHRs interceptados
 * @param {object} [params.raw_snapshot]         - snapshot bruto pra extrair signatures se nao foram passados
 * @param {number} [params.elapsed_ms]
 * @param {string|null} [params.error]
 * @param {string} [params.triggered_by]         - "cli" | "cron" | "manual" | "auto-refresh"
 */
export function recordScrapeHistory(params) {
  const {
    scope,
    ok,
    counters = null,
    total_orders = 0,
    xhr_count = 0,
    detected_store_ids = [],
    xhr_signatures: xhrSigsParam,
    raw_snapshot,
    elapsed_ms = null,
    error = null,
    triggered_by = "unknown",
  } = params;

  if (!scope) {
    log.warn("recordScrapeHistory: scope obrigatorio");
    return null;
  }

  const xhrSignatures =
    xhrSigsParam || (raw_snapshot ? extractXhrSignatures(raw_snapshot) : []);

  try {
    const elapsed = Number.isFinite(elapsed_ms)
      ? Math.max(0, Math.trunc(elapsed_ms))
      : null;
    const result = getStmtInsert().run(
      new Date().toISOString(),
      scope,
      ok ? 1 : 0,
      jsonStringifySafe(counters),
      Math.max(0, Math.trunc(Number(total_orders) || 0)),
      Math.max(0, Math.trunc(Number(xhr_count) || 0)),
      jsonStringifySafe(detected_store_ids),
      jsonStringifySafe(xhrSignatures),
      elapsed,
      error || null,
      String(triggered_by || "unknown")
    );
    return result.lastInsertRowid;
  } catch (err) {
    log.error("recordScrapeHistory falhou", err);
    return null;
  }
}

/**
 * Detecta drift na assinatura de XHRs comparando o ultimo run bem-sucedido
 * com a media dos ultimos N runs anteriores.
 *
 * Retorna { has_drift, message, changes[] }:
 *   - has_drift true quando: endpoint conhecido sumiu OU novo endpoint aparece
 *   - changes lista cada diff humano-legivel
 *
 * Limit padrao: ultimo run vs 10 anteriores.
 */
export function detectXhrDrift(scope, options = {}) {
  const { limit = 10 } = options;
  if (!scope) return { has_drift: false, message: "scope obrigatorio", changes: [] };

  const safeLimit = Math.max(2, Math.min(50, Math.trunc(Number(limit) || 10)));

  try {
    const rows = getStmtSelectByScope().all(scope, safeLimit + 1);

    if (rows.length < 2) {
      return {
        has_drift: false,
        message: "historico insuficiente (precisa >=2 runs ok pro mesmo scope)",
        changes: [],
      };
    }

    const latest = rows[0];
    const previous = rows.slice(1);

    // Parse defensivo por-row: linha legada com JSON corrompido nao quebra
    // toda a deteccao.
    const latestSigs = new Set(jsonParseSafe(latest.xhr_signatures_json, []));
    const expectedSigs = new Set();
    for (const r of previous) {
      const sigs = jsonParseSafe(r.xhr_signatures_json, []);
      if (Array.isArray(sigs)) for (const s of sigs) expectedSigs.add(s);
    }

    // Tres buckets em um unico pass
    const criticalMissing = [];
    const minorMissing = [];
    for (const s of expectedSigs) {
      if (latestSigs.has(s)) continue;
      if (KNOWN_ML_PATH_PATTERNS.some((re) => re.test(s))) {
        criticalMissing.push(s);
      } else {
        minorMissing.push(s);
      }
    }
    const newSigs = [];
    for (const s of latestSigs) {
      if (!expectedSigs.has(s)) newSigs.push(s);
    }

    const changes = [];
    for (const s of criticalMissing) changes.push(`CRITICO: endpoint conhecido sumiu: ${s}`);
    for (const s of minorMissing) changes.push(`endpoint sumiu: ${s}`);
    for (const s of newSigs) changes.push(`endpoint novo: ${s}`);

    return {
      has_drift: changes.length > 0,
      message:
        changes.length === 0
          ? "sem drift detectado"
          : `${changes.length} mudancas (${criticalMissing.length} criticas)`,
      changes,
      latest_run_id: latest.id,
      compared_against_n_runs: previous.length,
    };
  } catch (err) {
    log.error("detectXhrDrift falhou", err);
    return { has_drift: false, message: `erro: ${err.message}`, changes: [] };
  }
}

/**
 * Estatisticas das ultimas N execucoes pra dashboard de saude.
 * Retorna { total_runs, success_rate, avg_elapsed_ms, last_run_at, last_error }.
 */
export function getScrapeHealthStats(scope = null, options = {}) {
  const { sinceHours = 24 } = options;
  const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  try {
    const where = scope ? "WHERE scope = ? AND captured_at >= ?" : "WHERE captured_at >= ?";
    const args = scope ? [scope, cutoff] : [cutoff];

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS total_runs,
           SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS successes,
           AVG(elapsed_ms) AS avg_elapsed_ms,
           MAX(captured_at) AS last_run_at
         FROM ml_scrape_history
         ${where}`
      )
      .get(...args);

    const lastError = db
      .prepare(
        `SELECT captured_at, error
         FROM ml_scrape_history
         ${where} AND ok = 0
         ORDER BY captured_at DESC
         LIMIT 1`
      )
      .get(...args);

    const total = Number(stats?.total_runs || 0);
    const successes = Number(stats?.successes || 0);

    return {
      scope: scope || "all",
      since_hours: sinceHours,
      total_runs: total,
      success_rate: total > 0 ? Number((successes / total).toFixed(3)) : null,
      avg_elapsed_ms: stats?.avg_elapsed_ms ? Math.round(stats.avg_elapsed_ms) : null,
      last_run_at: stats?.last_run_at || null,
      last_error: lastError
        ? { at: lastError.captured_at, message: lastError.error }
        : null,
    };
  } catch (err) {
    log.error("getScrapeHealthStats falhou", err);
    return null;
  }
}

/**
 * Limpa registros antigos (>N dias). Best-effort, silencioso.
 */
export function pruneScrapeHistory(daysToKeep = 30) {
  try {
    const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString();
    const result = getStmtPrune().run(cutoff);
    return result.changes || 0;
  } catch (err) {
    log.error("pruneScrapeHistory falhou", err);
    return 0;
  }
}
