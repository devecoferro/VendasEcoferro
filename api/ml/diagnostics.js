import {
  buildDashboardPayload,
  fetchMLLiveChipBucketsDetailed,
  invalidateDashboardCache,
} from "./dashboard.js";
import { runActiveOrdersRefresh, refreshMLOrdersByIds } from "./sync.js";
import { getLatestConnection, listConnections } from "./_lib/storage.js";
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
 * Analise order-level de divergencia entre ML e app. Identifica EXATAMENTE
 * quais pedidos estao em buckets diferentes — util quando `computeChipCountsDiff`
 * reporta drift persistente e precisa-se saber onde esta o bug.
 *
 * Operacao cara (~10-20 ML API calls + buildDashboardPayload completo).
 * Chamar apenas sob demanda, nao em polling.
 *
 * Retorna:
 *  - divergences: lista de { order_id, ml_bucket, app_bucket }
 *  - patterns:    top padroes de misclassificacao (ex: "upcoming→today" × 5)
 *  - total_divergent: total de pedidos divergentes
 */
export async function computeOrdersDivergence(options = {}) {
  const { fresh = true, limit = 500, connectionId = null } = options;
  const timestamp = new Date().toISOString();

  // Bug 2026-04-29 multi-seller: agregar todas as conexoes (Ecoferro+Fantom)
  // gerava 189 missing→bucket falsos porque payload.deposits so cobre a base
  // connection. Agora compara apenas o escopo da connection base (default ou
  // explicitamente passada) — alinhado com como o dashboard renderiza.
  const baseConnection = connectionId
    ? listConnections().find((c) => c.id === connectionId) || null
    : getLatestConnection();
  const connections = baseConnection?.id ? [baseConnection] : [];
  if (connections.length === 0) {
    return {
      timestamp,
      error: "Nenhuma conexao ML configurada",
      ml_connections_queried: 0,
      ml_connections_succeeded: 0,
      total_divergent: 0,
      patterns: [],
      divergences: [],
      truncated: false,
    };
  }

  // ─── Lado ML ─────────────────────────────────────────
  // Busca a classificacao real do ML para cada order_id
  const mlResults = await Promise.all(
    connections.map((c) =>
      fetchMLLiveChipBucketsDetailed(c).catch(() => null)
    )
  );

  const mlBucketOfOrder = new Map();
  for (const result of mlResults) {
    if (!result?.order_ids_by_bucket) continue;
    for (const bucket of CHIP_BUCKETS) {
      const ids = result.order_ids_by_bucket[bucket];
      if (!ids) continue;
      const iter = ids instanceof Set ? ids.values() : ids;
      for (const id of iter) {
        const str = String(id);
        // Se ja marcado em outro bucket (improvavel), mantem o primeiro
        if (!mlBucketOfOrder.has(str)) mlBucketOfOrder.set(str, bucket);
      }
    }
  }

  // ─── Lado App ────────────────────────────────────────
  // Lê a classificacao interna do payload do dashboard.
  // ⚠️ deposit.order_ids_by_bucket guarda DB row ids (formato
  // "${mlOrderId}:${itemId}"), não ML order ids. Como o lado ML usa
  // ML order ids puros, precisamos EXTRAIR o ml_order_id do db_row_id
  // (split por ":") pra os dois lados usarem a mesma chave.
  // Sem isso, a comparação gera 100% falsos divergentes.
  //
  // FIX 2026-05-04: Também mapeia pack_id → bucket. O ML usa pack_id
  // como chave principal pra pedidos com carrinho. Se o app só indexa
  // por order_id, pedidos com pack aparecem como "missing" no lado app
  // gerando falsos divergentes (o ML retorna pack_id, app retorna order_id).
  const payload = await buildDashboardPayload({ allowCache: !fresh });
  const appBucketOfOrder = new Map();
  const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];

  // Primeiro: buscar todos os orders do DB pra construir mapa pack_id → order_ids
  const allOrders = [];
  for (const deposit of deposits) {
    if (deposit._orders) {
      for (const o of deposit._orders) allOrders.push(o);
    }
  }
  // Mapa: pack_id → order_id (pra traduzir pack_ids do ML pro lado app)
  const packIdToOrderIds = new Map();
  // Mapa: order_id → pack_id (pra traduzir order_ids do app pro lado ML)
  const orderIdToPackId = new Map();

  for (const deposit of deposits) {
    const idsByBucket =
      deposit.internal_operational_order_ids_by_bucket ||
      deposit.order_ids_by_bucket ||
      {};
    for (const bucket of CHIP_BUCKETS) {
      const ids = idsByBucket[bucket];
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        const raw = String(id);
        // DB row id = "${mlOrderId}:${itemId}"; ML order id é o prefixo.
        // Se não tiver ":", já é um ML order id puro.
        const mlOrderId = raw.includes(":") ? raw.split(":")[0] : raw;
        if (!appBucketOfOrder.has(mlOrderId)) {
          appBucketOfOrder.set(mlOrderId, bucket);
        }
      }
    }
  }

  // FIX 2026-05-04: Busca pack_ids dos orders no DB pra normalizar a comparação.
  // Quando o ML retorna um pack_id nos buckets, precisamos saber qual order_id
  // corresponde pra verificar se o app já tem esse pedido classificado.
  try {
    const rows = db.prepare(
      `SELECT order_id, raw_data FROM ml_orders WHERE order_id IS NOT NULL`
    ).all();
    for (const row of rows) {
      const rawData = typeof row.raw_data === "string"
        ? JSON.parse(row.raw_data)
        : row.raw_data;
      const packId = rawData?.pack_id ? String(rawData.pack_id) : null;
      if (packId && row.order_id) {
        const orderId = String(row.order_id);
        orderIdToPackId.set(orderId, packId);
        if (!packIdToOrderIds.has(packId)) packIdToOrderIds.set(packId, []);
        packIdToOrderIds.get(packId).push(orderId);
      }
    }
  } catch {
    // Se falhar a query, segue sem o mapa (backward compatible)
  }

  // ─── Diff por order_id (normalizado com pack_id) ─────────────
  // Normalização: se o ML retorna um pack_id e o app tem o order_id
  // correspondente no MESMO bucket, não é divergente.
  const allIds = new Set([
    ...mlBucketOfOrder.keys(),
    ...appBucketOfOrder.keys(),
  ]);
  const divergences = [];
  const alreadyChecked = new Set();
  for (const orderId of allIds) {
    if (alreadyChecked.has(orderId)) continue;
    alreadyChecked.add(orderId);

    let mlBucket = mlBucketOfOrder.get(orderId) || null;
    let appBucket = appBucketOfOrder.get(orderId) || null;

    // Se o ML tem esse ID como pack_id mas o app não o conhece,
    // verifica se algum order_id filho desse pack está no app
    if (mlBucket && !appBucket) {
      const childOrderIds = packIdToOrderIds.get(orderId);
      if (childOrderIds) {
        for (const childId of childOrderIds) {
          const childBucket = appBucketOfOrder.get(childId);
          if (childBucket) {
            appBucket = childBucket;
            alreadyChecked.add(childId);
            break;
          }
        }
      }
    }

    // Se o app tem esse ID como order_id mas o ML não o conhece,
    // verifica se o pack_id pai está no ML
    if (appBucket && !mlBucket) {
      const parentPackId = orderIdToPackId.get(orderId);
      if (parentPackId) {
        const parentBucket = mlBucketOfOrder.get(parentPackId);
        if (parentBucket) {
          mlBucket = parentBucket;
          alreadyChecked.add(parentPackId);
        }
      }
    }

    if (mlBucket !== appBucket) {
      divergences.push({
        order_id: orderId,
        ml_bucket: mlBucket,
        app_bucket: appBucket,
      });
    }
  }

  // Ordena: primeiro os que o ML classifica em today (mais urgente), depois outros
  const bucketPriority = {
    today: 0,
    upcoming: 1,
    in_transit: 2,
    finalized: 3,
    cancelled: 4,
    null: 5,
  };
  divergences.sort((a, b) => {
    const pa = bucketPriority[a.ml_bucket ?? "null"] ?? 99;
    const pb = bucketPriority[b.ml_bucket ?? "null"] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.order_id.localeCompare(b.order_id);
  });

  // Padroes de misclassificacao (ex: app_bucket=upcoming → ml_bucket=today tem N casos)
  const patternCounts = new Map();
  for (const d of divergences) {
    const key = `${d.app_bucket || "missing"}→${d.ml_bucket || "missing"}`;
    patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
  }
  const patterns = Array.from(patternCounts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  return {
    timestamp,
    ml_connections_queried: connections.length,
    ml_connections_succeeded: mlResults.filter(Boolean).length,
    total_divergent: divergences.length,
    patterns,
    divergences: divergences.slice(0, limit),
    truncated: divergences.length > limit,
  };
}

/**
 * Auto-heal: quando drift e detectado, tenta corrigir forcando um
 * `runActiveOrdersRefresh` (puxa dados frescos do ML para todas as conexoes),
 * invalida o cache do dashboard e re-verifica.
 *
 * Retorna { healed, reason, refreshed_orders, before, after }:
 *   - healed=true  + reason=RESOLVED_AFTER_REFRESH → era so timing (dados stale)
 *   - healed=true  + reason=ALREADY_IN_SYNC        → nao havia drift
 *   - healed=false + reason=PARTIALLY_HEALED       → diff diminuiu mas nao zerou
 *   - healed=false + reason=PERSISTENT_CLASSIFICATION_BUG → diff igual/pior (bug de codigo)
 *   - healed=false + reason=ML_API_UNAVAILABLE     → nao foi possivel verificar
 */
export async function autoHealDrift(options = {}) {
  const { tolerance = DEFAULT_TOLERANCE } = options;

  const before = await computeChipCountsDiff({
    tolerance,
    includeBreakdown: false,
    fresh: true,
  });

  if (before.status === "ML_API_UNAVAILABLE") {
    return { healed: false, reason: "ML_API_UNAVAILABLE", refreshed_orders: 0, before, after: null };
  }
  if (before.status === "IN_SYNC") {
    return { healed: true, reason: "ALREADY_IN_SYNC", refreshed_orders: 0, before, after: null };
  }

  const connections = listConnections().filter((c) => c?.id);
  let refreshed = 0;
  for (const connection of connections) {
    try {
      const r = await runActiveOrdersRefresh({ connectionId: connection.id });
      refreshed += r?.totalRefreshed || 0;
    } catch (err) {
      // best-effort — segue tentando outras conexoes
      console.error(
        "[autoHealDrift] Active refresh falhou",
        err instanceof Error ? err.message : err
      );
    }
  }

  invalidateDashboardCache();

  const after = await computeChipCountsDiff({
    tolerance,
    includeBreakdown: false,
    fresh: true,
  });

  if (after.status === "ML_API_UNAVAILABLE") {
    return { healed: false, reason: "ML_API_UNAVAILABLE", refreshed_orders: refreshed, before, after };
  }

  const healed = after.status === "IN_SYNC";
  let reason;
  if (healed) {
    reason = "RESOLVED_AFTER_REFRESH";
  } else if (after.max_abs_diff < before.max_abs_diff) {
    reason = "PARTIALLY_HEALED";
  } else {
    reason = "PERSISTENT_CLASSIFICATION_BUG";
  }

  return { healed, reason, refreshed_orders: refreshed, before, after };
}

/**
 * Hard auto-heal: reclassificação forçada a partir da fonte de verdade (ML).
 *
 * Diferente do autoHealDrift (que faz busca por shipping_status), este:
 *   1. Roda computeOrdersDivergence pra identificar EXATAMENTE quais pedidos
 *      estão em buckets diferentes (source: app vs ML)
 *   2. Re-busca CADA pedido divergente via GET /orders/{id} + /shipments/{id}
 *   3. Sobrescreve raw_data no DB com a resposta atual do ML (fonte de verdade)
 *   4. Invalida cache e re-verifica
 *
 * Usado quando autoHealDrift retorna PERSISTENT_CLASSIFICATION_BUG (active
 * refresh já foi feito mas drift continua) — sinal de que o DB está com
 * raw_data desatualizado pra alguns pedidos específicos, ou o pedido caiu
 * fora dos filtros de status do active refresh.
 *
 * Custo: 2×N ML API calls (N = pedidos divergentes). Cooldown recomendado:
 * 5min por connection_id.
 *
 * Retorna {
 *   healed, reason, orders_refreshed, divergences_before,
 *   patterns, before, after, errors
 * }
 */
export async function hardHealDrift(options = {}) {
  const { tolerance = DEFAULT_TOLERANCE, maxOrdersToRefresh = 200 } = options;
  const timestamp = new Date().toISOString();

  const before = await computeChipCountsDiff({
    tolerance,
    includeBreakdown: false,
    fresh: true,
  });

  if (before.status === "ML_API_UNAVAILABLE") {
    return {
      healed: false,
      reason: "ML_API_UNAVAILABLE",
      orders_refreshed: 0,
      divergences_before: 0,
      patterns: [],
      before,
      after: null,
      errors: [],
      timestamp,
    };
  }
  if (before.status === "IN_SYNC") {
    return {
      healed: true,
      reason: "ALREADY_IN_SYNC",
      orders_refreshed: 0,
      divergences_before: 0,
      patterns: [],
      before,
      after: null,
      errors: [],
      timestamp,
    };
  }

  // Identifica EXATAMENTE quais pedidos estão mal classificados
  const divergence = await computeOrdersDivergence({
    fresh: true,
    limit: maxOrdersToRefresh,
  });

  if (!divergence.divergences || divergence.divergences.length === 0) {
    // Chips divergem mas nenhum pedido divergente individual identificado —
    // pode ser timing de cache ou bug no nivel agregado (pack dedup).
    return {
      healed: false,
      reason: "NO_ORDER_LEVEL_DIVERGENCE",
      orders_refreshed: 0,
      divergences_before: 0,
      patterns: [],
      before,
      after: before,
      errors: [],
      timestamp,
    };
  }

  const divergentOrderIds = divergence.divergences.map((d) => d.order_id);
  const patterns = divergence.patterns || [];

  // Mapeia order_id → connection_id pra chamar refresh no connection certo
  const connectionByOrderId = new Map();
  try {
    const placeholders = divergentOrderIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT DISTINCT order_id, connection_id FROM ml_orders WHERE order_id IN (${placeholders})`
      )
      .all(...divergentOrderIds);
    for (const row of rows) {
      connectionByOrderId.set(String(row.order_id), row.connection_id);
    }
  } catch (err) {
    // DB lookup failed — best-effort; segue com connection default se houver só 1
  }

  // Se todos os pedidos divergentes não estão no banco (ex: ML tem em today
  // mas app não tem o pedido), fallback pra conexão mais recente
  const connections = listConnections().filter((c) => c?.id);
  const defaultConnectionId = connections[0]?.id || null;

  // Agrupa por connection_id
  const orderIdsByConnection = new Map();
  for (const orderId of divergentOrderIds) {
    const connId = connectionByOrderId.get(orderId) || defaultConnectionId;
    if (!connId) continue;
    if (!orderIdsByConnection.has(connId)) orderIdsByConnection.set(connId, []);
    orderIdsByConnection.get(connId).push(orderId);
  }

  const allErrors = [];
  let totalRefreshed = 0;

  for (const [connId, ids] of orderIdsByConnection.entries()) {
    try {
      const result = await refreshMLOrdersByIds({
        connectionId: connId,
        orderIds: ids,
      });
      totalRefreshed += result.totalRefreshed || 0;
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        allErrors.push(...result.errors.slice(0, 10));
      }
    } catch (err) {
      allErrors.push({
        order_id: null,
        message: `connection ${connId}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  invalidateDashboardCache();

  const after = await computeChipCountsDiff({
    tolerance,
    includeBreakdown: false,
    fresh: true,
  });

  if (after.status === "ML_API_UNAVAILABLE") {
    return {
      healed: false,
      reason: "ML_API_UNAVAILABLE_AFTER_REFRESH",
      orders_refreshed: totalRefreshed,
      divergences_before: divergentOrderIds.length,
      patterns,
      before,
      after,
      errors: allErrors,
      timestamp,
    };
  }

  const healed = after.status === "IN_SYNC";
  let reason;
  if (healed) {
    reason = "RESOLVED_AFTER_HARD_REFRESH";
  } else if (after.max_abs_diff < before.max_abs_diff) {
    reason = "PARTIALLY_HEALED";
  } else {
    // Mesmo após re-fetch pedido-a-pedido da fonte de verdade, o diff
    // persiste. Isso indica bug na lógica de classificação do dashboard
    // (não é dado stale). Precisa intervenção no código.
    reason = "PERSISTENT_CLASSIFICATION_LOGIC_BUG";
  }

  return {
    healed,
    reason,
    orders_refreshed: totalRefreshed,
    divergences_before: divergentOrderIds.length,
    patterns,
    before,
    after,
    errors: allErrors,
    timestamp,
  };
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
  const method = (request.method || "GET").toUpperCase();
  // heal aceita POST (dispara acao), demais sao GET
  if (method !== "GET" && method !== "POST") {
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

    if (action === "orders-diff") {
      // Analise order-level: lenta (~10-20s), usar sob demanda
      const limit = Math.max(1, Math.min(2000, Number(request.query?.limit || 500)));
      const fresh = request.query?.fresh == null ? true : parseBoolean(request.query?.fresh);
      const divergence = await computeOrdersDivergence({ fresh, limit });
      return response.status(200).json(divergence);
    }

    if (action === "heal") {
      // Acao que modifica estado (force refresh) — exige POST
      if (method !== "POST") {
        return response.status(405).json({ error: "Use POST para action=heal" });
      }
      const tolerance = Number(request.query?.tolerance || DEFAULT_TOLERANCE);
      const result = await autoHealDrift({ tolerance });
      // Persiste sempre os dois snapshots (before/after) pra rastreamento
      try {
        if (result.before && result.before.status !== "ML_API_UNAVAILABLE") {
          saveChipDriftSnapshot(result.before, "heal_before");
        }
        if (result.after && result.after.status !== "ML_API_UNAVAILABLE") {
          const afterSource = result.healed
            ? "heal_resolved"
            : result.reason === "PARTIALLY_HEALED"
              ? "heal_partial"
              : "heal_persistent";
          saveChipDriftSnapshot(result.after, afterSource);
        }
      } catch {
        // best-effort
      }
      return response.status(200).json(result);
    }

    if (action === "hard-heal") {
      // Auto-correção profunda: identifica pedidos divergentes via
      // computeOrdersDivergence e re-busca cada um via ML API direto,
      // sobrescrevendo raw_data no DB com a fonte de verdade.
      // Custoso (~2×N ML API calls). Usar quando autoHealDrift (soft)
      // não resolveu.
      if (method !== "POST") {
        return response.status(405).json({ error: "Use POST para action=hard-heal" });
      }
      const tolerance = Number(request.query?.tolerance || DEFAULT_TOLERANCE);
      const maxOrdersToRefresh = Math.max(
        1,
        Math.min(1000, Number(request.query?.max || 200))
      );
      const result = await hardHealDrift({ tolerance, maxOrdersToRefresh });
      try {
        if (result.before && result.before.status !== "ML_API_UNAVAILABLE") {
          saveChipDriftSnapshot(result.before, "hard_heal_before");
        }
        if (result.after && result.after.status !== "ML_API_UNAVAILABLE") {
          const afterSource = result.healed
            ? "hard_heal_resolved"
            : result.reason === "PARTIALLY_HEALED"
              ? "hard_heal_partial"
              : "hard_heal_persistent";
          saveChipDriftSnapshot(result.after, afterSource);
        }
      } catch {
        // best-effort
      }
      return response.status(200).json(result);
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
