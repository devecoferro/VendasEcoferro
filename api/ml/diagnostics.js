import { buildDashboardPayload } from "./dashboard.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { db } from "../_lib/db.js";

/**
 * /api/ml/diagnostics — Verification endpoint for ML chip counts.
 *
 * Compares the ML Seller Center live chip counts (fetchMLLiveChipCounts)
 * with the app's internal classification (sum of deposit.internal_operational_counts),
 * returning a structured diff. Can be polled continuously to detect drift.
 *
 * Query params:
 *   action=verify (default) | history
 *   tolerance=N           — absolute diff threshold for IN_SYNC status (default: 2)
 *   breakdown=true|false  — include per-deposit breakdown (default: true)
 *   deposit_key=...       — filter counts to a single deposit
 *   logistic_type=...     — filter counts to "fulfillment" | "cross_docking"
 *   save=true             — persist snapshot to ml_chip_drift_history
 *   fresh=true            — bypass 30s dashboard cache (slower, hits ML API)
 *   limit=N               — for action=history only (default: 50, max: 1000)
 */

const CHIP_BUCKETS = ["today", "upcoming", "in_transit", "finalized", "cancelled"];
const DEFAULT_TOLERANCE = 2;

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value == null) return false;
  const str = String(value).trim().toLowerCase();
  return str === "true" || str === "1" || str === "yes";
}

function emptyCounts() {
  return { today: 0, upcoming: 0, in_transit: 0, finalized: 0, cancelled: 0 };
}

function normalizeCounts(source) {
  const out = emptyCounts();
  for (const bucket of CHIP_BUCKETS) {
    out[bucket] = Number(source?.[bucket] || 0);
  }
  return out;
}

function filterDeposits(deposits, filters) {
  if (!Array.isArray(deposits)) return [];
  let filtered = deposits;
  if (filters.deposit_key) {
    filtered = filtered.filter((d) => d.key === filters.deposit_key);
  }
  if (filters.logistic_type) {
    filtered = filtered.filter((d) => d.logistic_type === filters.logistic_type);
  }
  return filtered;
}

function sumInternalCounts(deposits) {
  const counts = emptyCounts();
  for (const deposit of deposits) {
    const depositCounts = deposit.internal_operational_counts || deposit.counts || {};
    for (const bucket of CHIP_BUCKETS) {
      counts[bucket] += Number(depositCounts[bucket] || 0);
    }
  }
  return counts;
}

function buildDepositBreakdown(deposits) {
  return deposits.map((deposit) => ({
    key: deposit.key,
    label: deposit.label,
    logistic_type: deposit.logistic_type,
    counts: normalizeCounts(
      deposit.internal_operational_counts || deposit.counts || {}
    ),
    total:
      Number(deposit.internal_operational_total_count || deposit.total_count || 0),
  }));
}

/**
 * Computes a diff between ML Seller Center live chip counts and the app's
 * internal classification. Returns a structured result that the UI/CLI can
 * render directly.
 */
export async function computeChipCountsDiff(options = {}) {
  const {
    tolerance = DEFAULT_TOLERANCE,
    includeBreakdown = true,
    filters = {},
    fresh = false,
  } = options;

  const payload = await buildDashboardPayload({ allowCache: !fresh });
  const mlCounts = payload.ml_live_chip_counts || null;

  const timestamp = new Date().toISOString();

  if (!mlCounts) {
    return {
      timestamp,
      status: "ML_API_UNAVAILABLE",
      error: "Could not fetch live counts from Mercado Livre API",
      tolerance,
      max_abs_diff: 0,
      ml_seller_center: emptyCounts(),
      app_internal: emptyCounts(),
      diff: emptyCounts(),
      filters,
    };
  }

  const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];
  const filteredDeposits = filterDeposits(deposits, filters);
  const hasFilter = Object.keys(filters).length > 0;

  // NOTE: if filters are applied, the ML API counts don't narrow (ML API
  // returns global counts). We still surface the global mlCounts but flag
  // the filter application so the UI can render a warning.
  const internalCounts = sumInternalCounts(
    hasFilter ? filteredDeposits : deposits
  );

  const mlNormalized = normalizeCounts(mlCounts);
  const diff = emptyCounts();
  let maxAbsDiff = 0;
  for (const bucket of CHIP_BUCKETS) {
    diff[bucket] = internalCounts[bucket] - mlNormalized[bucket];
    if (Math.abs(diff[bucket]) > maxAbsDiff) {
      maxAbsDiff = Math.abs(diff[bucket]);
    }
  }

  const status = maxAbsDiff <= tolerance ? "IN_SYNC" : "DRIFT_DETECTED";

  const result = {
    timestamp,
    status,
    tolerance,
    max_abs_diff: maxAbsDiff,
    ml_seller_center: mlNormalized,
    app_internal: internalCounts,
    diff,
    filters,
    filter_applied: hasFilter,
    filter_warning: hasFilter
      ? "ML Seller Center counts are global and do not honor filters — app_internal is filtered, diff may be expected."
      : null,
  };

  if (includeBreakdown) {
    result.breakdown_by_deposit = buildDepositBreakdown(
      hasFilter ? filteredDeposits : deposits
    );
  }

  return result;
}

/**
 * Persists a diff snapshot into ml_chip_drift_history.
 * Silent on failure (best-effort telemetry).
 */
export function saveChipDriftSnapshot(diffResult, source = "manual") {
  if (!diffResult || !diffResult.timestamp) return false;
  try {
    const stmt = db.prepare(`
      INSERT INTO ml_chip_drift_history (
        captured_at, status, max_abs_diff,
        ml_today, ml_upcoming, ml_in_transit, ml_finalized, ml_cancelled,
        app_today, app_upcoming, app_in_transit, app_finalized, app_cancelled,
        diff_today, diff_upcoming, diff_in_transit, diff_finalized, diff_cancelled,
        filters_json, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      diffResult.timestamp,
      diffResult.status,
      Number(diffResult.max_abs_diff || 0),
      Number(diffResult.ml_seller_center?.today || 0),
      Number(diffResult.ml_seller_center?.upcoming || 0),
      Number(diffResult.ml_seller_center?.in_transit || 0),
      Number(diffResult.ml_seller_center?.finalized || 0),
      Number(diffResult.ml_seller_center?.cancelled || 0),
      Number(diffResult.app_internal?.today || 0),
      Number(diffResult.app_internal?.upcoming || 0),
      Number(diffResult.app_internal?.in_transit || 0),
      Number(diffResult.app_internal?.finalized || 0),
      Number(diffResult.app_internal?.cancelled || 0),
      Number(diffResult.diff?.today || 0),
      Number(diffResult.diff?.upcoming || 0),
      Number(diffResult.diff?.in_transit || 0),
      Number(diffResult.diff?.finalized || 0),
      Number(diffResult.diff?.cancelled || 0),
      JSON.stringify(diffResult.filters || {}),
      source
    );
    return true;
  } catch (err) {
    console.error("[saveChipDriftSnapshot] Failed:", err.message);
    return false;
  }
}

/**
 * Returns the last N drift history entries (most recent first).
 */
export function getChipDriftHistory(limit = 50) {
  try {
    const bounded = Math.max(1, Math.min(1000, Number(limit) || 50));
    return db
      .prepare(
        `SELECT * FROM ml_chip_drift_history ORDER BY captured_at DESC LIMIT ?`
      )
      .all(bounded);
  } catch {
    return [];
  }
}

/**
 * Retention: keep only the last 30 days of drift history to avoid table growth.
 */
export function pruneChipDriftHistory(daysToKeep = 30) {
  try {
    const cutoff = new Date(
      Date.now() - daysToKeep * 24 * 60 * 60 * 1000
    ).toISOString();
    const res = db
      .prepare(`DELETE FROM ml_chip_drift_history WHERE captured_at < ?`)
      .run(cutoff);
    return res.changes || 0;
  } catch {
    return 0;
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const action = String(request.query?.action || "verify").trim().toLowerCase();

    if (action === "history") {
      const limit = Number(request.query?.limit || 50);
      const history = getChipDriftHistory(limit);
      return response.status(200).json({ history, count: history.length });
    }

    const tolerance = Number(request.query?.tolerance || DEFAULT_TOLERANCE);
    const includeBreakdown = !parseBoolean(request.query?.breakdown === "false");
    const fresh = parseBoolean(request.query?.fresh);
    const save = parseBoolean(request.query?.save);

    const filters = {};
    if (request.query?.deposit_key) {
      filters.deposit_key = String(request.query.deposit_key).trim();
    }
    if (request.query?.logistic_type) {
      filters.logistic_type = String(request.query.logistic_type).trim();
    }

    const result = await computeChipCountsDiff({
      tolerance,
      includeBreakdown,
      filters,
      fresh,
    });

    if (save && result.status !== "ML_API_UNAVAILABLE") {
      saveChipDriftSnapshot(result, "api_request");
    }

    return response.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
