import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  getLatestConnection,
  getOrderReferenceSummaries,
} from "./_lib/storage.js";
import { buildDashboardPayload } from "./dashboard.js";
import { listMirrorEntityReferences } from "./_lib/mirror-storage.js";
import {
  getLatestPrivateSellerCenterSnapshotsByStoreAndTab,
  getPrivateSellerCenterSnapshotStatus,
} from "./_lib/private-seller-center-storage.js";
import { derivePrivateSellerCenterPostSaleMetrics } from "./_lib/private-seller-center-audit.js";

const VIEW_LABEL_FALLBACKS = {
  all: "Todas as vendas",
  unknown: "Vendas sem depÃ³sito",
  full: "Full",
};
const COMPARISON_CACHE_TTL_MS = 5 * 60 * 1000;
const comparisonCache = new Map();

export function invalidatePrivateSellerCenterComparisonCache() {
  comparisonCache.clear();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

function getComparisonCacheKey(connectionId, sellerId, snapshotStatus, lastSyncAt) {
  return [
    connectionId || "no-connection",
    sellerId || "no-seller",
    snapshotStatus?.last_captured_at || "no-snapshot",
    snapshotStatus?.total_snapshots || 0,
    lastSyncAt || "no-sync",
  ].join(":");
}

function readComparisonCache(cacheKey) {
  const cached = comparisonCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    comparisonCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function writeComparisonCache(cacheKey, payload) {
  comparisonCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + COMPARISON_CACHE_TTL_MS,
  });
}

function buildEmptyCounts() {
  return {
    today: 0,
    upcoming: 0,
    in_transit: 0,
    finalized: 0,
  };
}

function addCounts(target, source = {}) {
  target.today += normalizeInteger(source.today);
  target.upcoming += normalizeInteger(source.upcoming);
  target.in_transit += normalizeInteger(source.in_transit);
  target.finalized += normalizeInteger(source.finalized);
  return target;
}

function subtractCounts(left, right) {
  return {
    today: normalizeInteger(left.today) - normalizeInteger(right.today),
    upcoming: normalizeInteger(left.upcoming) - normalizeInteger(right.upcoming),
    in_transit: normalizeInteger(left.in_transit) - normalizeInteger(right.in_transit),
    finalized: normalizeInteger(left.finalized) - normalizeInteger(right.finalized),
  };
}

function matchesSnapshotView(deposit, store) {
  if (store === "all") {
    return true;
  }

  if (store === "unknown") {
    return deposit.key === "without-deposit";
  }

  if (store === "full") {
    return deposit.logistic_type === "fulfillment";
  }

  return deposit.key === store || deposit.key === `store:${store}`;
}

function aggregateDashboardView(deposits, store, countFieldPrefix) {
  const matchingDeposits = (Array.isArray(deposits) ? deposits : []).filter((deposit) =>
    matchesSnapshotView(deposit, store)
  );
  const counts = buildEmptyCounts();
  const sources = new Set();
  let totalCount = 0;

  for (const deposit of matchingDeposits) {
    const layerCounts =
      countFieldPrefix === "internal"
        ? deposit.internal_operational_counts || deposit.counts
        : deposit.seller_center_mirror_counts || deposit.native_counts;
    addCounts(counts, layerCounts);

    if (countFieldPrefix === "internal") {
      totalCount += normalizeInteger(
        deposit.internal_operational_total_count ?? deposit.total_count
      );
      if (deposit.internal_operational_source || deposit.operational_source) {
        sources.add(deposit.internal_operational_source || deposit.operational_source);
      }
    } else {
      totalCount += normalizeInteger(
        deposit.seller_center_mirror_total_count ?? deposit.native_total_count
      );
      if (deposit.seller_center_mirror_source || deposit.native_source) {
        sources.add(deposit.seller_center_mirror_source || deposit.native_source);
      }
    }
  }

  return {
    counts,
    total_count: totalCount,
    source: Array.from(sources),
  };
}

function mergeViewSets(target, source) {
  if (!target || !source) {
    return target;
  }

  for (const value of source) {
    target.add(value);
  }

  return target;
}

function resolveReferenceViews(reference) {
  const views = new Set(["all"]);
  const depositKey = normalizeNullable(reference?.deposit_key) || "without-deposit";

  if (depositKey === "without-deposit") {
    views.add("unknown");
  } else if (depositKey.startsWith("store:")) {
    views.add(depositKey.slice("store:".length));
  } else {
    views.add(depositKey);
  }

  if (normalizeNullable(reference?.logistic_type)?.toLowerCase() === "fulfillment") {
    views.add("full");
  }

  return views;
}

function buildOrderIndex(orderReferences) {
  const byOrderId = new Map();
  const byShipmentId = new Map();
  const byPackId = new Map();
  const orderCountsByView = new Map();

  for (const reference of Array.isArray(orderReferences) ? orderReferences : []) {
    if (!reference?.order_id) {
      continue;
    }

    const views = resolveReferenceViews(reference);

    for (const view of views) {
      orderCountsByView.set(view, Number(orderCountsByView.get(view) || 0) + 1);
    }

    if (!byOrderId.has(reference.order_id)) {
      byOrderId.set(reference.order_id, new Set());
    }
    mergeViewSets(byOrderId.get(reference.order_id), views);

    if (reference.shipment_id) {
      if (!byShipmentId.has(reference.shipment_id)) {
        byShipmentId.set(reference.shipment_id, new Set());
      }
      mergeViewSets(byShipmentId.get(reference.shipment_id), views);
    }

    if (reference.pack_id) {
      if (!byPackId.has(reference.pack_id)) {
        byPackId.set(reference.pack_id, new Set());
      }
      mergeViewSets(byPackId.get(reference.pack_id), views);
    }
  }

  return {
    byOrderId,
    byShipmentId,
    byPackId,
    orderCountsByView,
  };
}

function resolveEntityViewMatches(entity, orderIndex) {
  const matches = new Set();
  const orderId = normalizeNullable(entity?.order_id);
  const shipmentId = normalizeNullable(entity?.shipment_id);
  const packId = normalizeNullable(entity?.pack_id);

  if (orderId && orderIndex.byOrderId.has(orderId)) {
    mergeViewSets(matches, orderIndex.byOrderId.get(orderId));
  }

  if (shipmentId && orderIndex.byShipmentId.has(shipmentId)) {
    mergeViewSets(matches, orderIndex.byShipmentId.get(shipmentId));
  }

  if (packId && orderIndex.byPackId.has(packId)) {
    mergeViewSets(matches, orderIndex.byPackId.get(packId));
  }

  return matches;
}

function buildPersistedEntityViewCounts(orderIndex, mirrorEntities) {
  const countsByView = new Map();

  function ensureViewEntry(view) {
    if (!countsByView.has(view)) {
      countsByView.set(view, {
        orders: 0,
        packs: 0,
        claims: 0,
        returns: 0,
      });
    }

    return countsByView.get(view);
  }

  for (const [view, count] of orderIndex.orderCountsByView.entries()) {
    ensureViewEntry(view).orders = Number(count || 0);
  }

  for (const [entityType, rows] of Object.entries(mirrorEntities)) {
    for (const row of rows) {
      for (const view of resolveEntityViewMatches(row, orderIndex)) {
        ensureViewEntry(view)[entityType] += 1;
      }
    }
  }

  return countsByView;
}

function buildSnapshotComparisonView(snapshot, dashboardPayload, persistedCountsByView) {
  const store = snapshot.store;
  const privateCounts = snapshot.tab_counts || buildEmptyCounts();
  const postSaleMetrics = derivePrivateSellerCenterPostSaleMetrics(snapshot);
  const internalOperational = aggregateDashboardView(
    dashboardPayload?.deposits || [],
    store,
    "internal"
  );
  const sellerCenterMirror = aggregateDashboardView(
    dashboardPayload?.deposits || [],
    store,
    "mirror"
  );
  const persistedEntities = persistedCountsByView.get(store) || {
    orders: 0,
    packs: 0,
    claims: 0,
    returns: 0,
  };

  return {
    store,
    view_selector: snapshot.view_selector,
    view_label: snapshot.view_label || VIEW_LABEL_FALLBACKS[store] || store,
    selected_tab: snapshot.selected_tab,
    selected_tab_label: snapshot.selected_tab_label,
    captured_at: snapshot.captured_at,
    private_snapshot: {
      status: "available",
      counts: privateCounts,
      post_sale_count: normalizeInteger(postSaleMetrics.operational_count),
      post_sale_source: postSaleMetrics.source,
      post_sale_button_count_raw: normalizeInteger(postSaleMetrics.raw_button_count),
      post_sale_breakdown: {
        returns_in_progress: normalizeInteger(postSaleMetrics.returns_in_progress),
        in_review: normalizeInteger(postSaleMetrics.in_review),
        completed: normalizeInteger(postSaleMetrics.completed),
        not_completed: normalizeInteger(postSaleMetrics.not_completed),
        unread_messages: normalizeInteger(postSaleMetrics.unread_messages),
        action_required: normalizeInteger(postSaleMetrics.action_required),
      },
      cards: Array.isArray(snapshot.cards) ? snapshot.cards : [],
      tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks : [],
    },
    internal_operational: internalOperational,
    seller_center_mirror: {
      ...sellerCenterMirror,
      status: dashboardPayload?.seller_center_mirror?.status || "partial",
      note: dashboardPayload?.seller_center_mirror?.note || null,
    },
    persisted_entities: persistedEntities,
    differences: {
      internal_minus_private: subtractCounts(internalOperational.counts, privateCounts),
      mirror_minus_private: subtractCounts(sellerCenterMirror.counts, privateCounts),
    },
  };
}

export default async function handler(request, response) {
  try {
    await requireAuthenticatedProfile(request);

    const latestConnection = getLatestConnection();
    const sellerId = latestConnection?.seller_id || null;
    const snapshotStatus = getPrivateSellerCenterSnapshotStatus({ sellerId });
    const cacheKey = getComparisonCacheKey(
      latestConnection?.id,
      sellerId,
      snapshotStatus,
      latestConnection?.last_sync_at
    );
    const cachedPayload = readComparisonCache(cacheKey);

    if (cachedPayload) {
      return response.status(200).json(cachedPayload);
    }

    const latestSnapshots = getLatestPrivateSellerCenterSnapshotsByStoreAndTab({ sellerId });
    const dashboardPayload = await buildDashboardPayload({ allowCache: true });
    const orderIndex = buildOrderIndex(getOrderReferenceSummaries("all"));
    const mirrorEntities = {
      packs: listMirrorEntityReferences("packs", { sellerId, limit: null }),
      claims: listMirrorEntityReferences("claims", { sellerId, limit: null }),
      returns: listMirrorEntityReferences("returns", { sellerId, limit: null }),
    };
    const persistedCountsByView = buildPersistedEntityViewCounts(orderIndex, mirrorEntities);
    const payload = {
      status: "ok",
      generated_at: new Date().toISOString(),
      connection_id: latestConnection?.id || null,
      seller_id: sellerId,
      snapshot_status: snapshotStatus,
      internal_operational: dashboardPayload.internal_operational || null,
      seller_center_mirror: dashboardPayload.seller_center_mirror || null,
      views: latestSnapshots.map((snapshot) =>
        buildSnapshotComparisonView(snapshot, dashboardPayload, persistedCountsByView)
      ),
    };

    writeComparisonCache(cacheKey, payload);

    return response.status(200).json(payload);
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "private_seller_center_comparison",
    });
  }
}
