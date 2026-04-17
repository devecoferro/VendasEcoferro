import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import {
  deleteOrdersByOrderIds,
  getConnectionById,
  getConnectionBySellerId as getStoredConnectionBySellerId,
  replaceOrdersByOrderIds,
  updateConnectionLastSync,
  upsertOrders,
} from "./_lib/storage.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { syncClaims, syncPacks, syncReturns } from "./_lib/mirror-sync.js";
import { getMirrorEntityStats } from "./_lib/mirror-storage.js";
import { invalidateDashboardCache } from "./dashboard.js";
import { invalidateOrdersCache } from "./orders.js";
import { invalidatePrivateSellerCenterComparisonCache } from "./private-seller-center-comparison.js";
import { broadcastSyncComplete } from "./sync-events.js";

// Promise deduplication — prevents duplicate HTTP calls when running in parallel.
// If two concurrent tasks call cachedFetch with the same key, only one HTTP request fires;
// the second awaits the same promise.
const inflightPromises = new Map();
function cachedFetch(cache, key, fetchFn) {
  if (key == null) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  if (inflightPromises.has(key)) return inflightPromises.get(key);
  const promise = fetchFn()
    .then((result) => {
      cache.set(key, result);
      inflightPromises.delete(key);
      return result;
    })
    .catch((err) => {
      // Don't cache errors — allow retry on next access
      inflightPromises.delete(key);
      return null;
    });
  inflightPromises.set(key, promise);
  return promise;
}

const ML_PAGE_LIMIT = 50;
const DEFAULT_INCREMENTAL_MAX_PAGES = 20;
const DEFAULT_FULL_MAX_PAGES = 200;
const ABSOLUTE_MAX_PAGES = 500;
const INCREMENTAL_SYNC_COOLDOWN_MS = 45000;
const MIRROR_SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const syncRequestsInFlight = new Map();

// Piso de sincronizacao: nao buscar nada criado antes desta data. Aplicado
// a todos os caminhos (sync manual, active-refresh, webhooks), porque o
// sistema so precisa operar com vendas de 01/04/2026 em diante.
const MIN_SYNC_DATE_FROM = "2026-04-01";

function clampDateFrom(value) {
  if (typeof value !== "string" || value.length === 0) return MIN_SYNC_DATE_FROM;
  return value < MIN_SYNC_DATE_FROM ? MIN_SYNC_DATE_FROM : value;
}

function parseIsoDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldSkipIncrementalSync(connection, updatedFrom) {
  const normalizedUpdatedFrom = typeof updatedFrom === "string" ? updatedFrom.trim() : "";
  if (!normalizedUpdatedFrom || !connection?.last_sync_at) {
    return false;
  }

  const updatedFromDate = parseIsoDate(normalizedUpdatedFrom);
  const lastSyncDate = parseIsoDate(connection.last_sync_at);
  if (!updatedFromDate || !lastSyncDate) {
    return false;
  }

  if (lastSyncDate.getTime() < updatedFromDate.getTime()) {
    return false;
  }

  return Date.now() - lastSyncDate.getTime() <= INCREMENTAL_SYNC_COOLDOWN_MS;
}

function shouldRunMirrorEntitySync(connection, entity, options = {}) {
  const sellerId = connection?.seller_id ? String(connection.seller_id) : null;
  if (!sellerId) {
    return true;
  }

  if (options.force) {
    return true;
  }

  const stats = getMirrorEntityStats(entity, { sellerId });
  const lastSyncedAt = parseIsoDate(stats?.last_synced_at);
  if (!lastSyncedAt) {
    return true;
  }

  return Date.now() - lastSyncedAt.getTime() > MIRROR_SYNC_COOLDOWN_MS;
}

async function getSellerStores(accessToken, sellerId) {
  try {
    const storesResponse = await fetch(
      `https://api.mercadolibre.com/users/${sellerId}/stores/search?tags=stock_location`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!storesResponse.ok) {
      return [];
    }

    const storesPayload = await storesResponse.json();
    return Array.isArray(storesPayload.results) ? storesPayload.results : [];
  } catch {
    return [];
  }
}

async function getItemImageUrl(accessToken, itemId, cache) {
  if (!itemId) return null;
  return cachedFetch(cache, itemId, async () => {
    const itemResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!itemResponse.ok) return null;
    const itemPayload = await itemResponse.json();
    const pictures = Array.isArray(itemPayload.pictures) ? itemPayload.pictures : [];
    const firstPicture = pictures.find((p) => p?.secure_url || p?.url) ?? null;
    return firstPicture?.secure_url || firstPicture?.url ||
      itemPayload.secure_thumbnail || itemPayload.thumbnail || null;
  });
}

async function getShipmentSnapshot(accessToken, shippingId, cache) {
  if (!shippingId) return null;
  return cachedFetch(cache, shippingId, async () => {
    const shipmentResponse = await fetch(
      `https://api.mercadolibre.com/shipments/${shippingId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!shipmentResponse.ok) return null;
    const p = await shipmentResponse.json();
    return {
      id: p?.id ?? null,
      status: p?.status ?? null,
      substatus: p?.substatus ?? null,
      logistic_type: p?.logistic_type ?? null,
      mode: p?.mode ?? null,
      receiver_name: p?.receiver_address?.receiver_name || p?.receiver_name || null,
      status_history: {
        date_handling: p?.status_history?.date_handling ?? null,
        date_ready_to_ship: p?.status_history?.date_ready_to_ship ?? null,
        date_shipped: p?.status_history?.date_shipped ?? null,
        date_delivered: p?.status_history?.date_delivered ?? null,
        date_cancelled: p?.status_history?.date_cancelled ?? null,
        date_returned: p?.status_history?.date_returned ?? null,
        date_not_delivered: p?.status_history?.date_not_delivered ?? null,
      },
      shipping_option: {
        name: p?.shipping_option?.name ?? null,
        estimated_delivery_limit: p?.shipping_option?.estimated_delivery_limit?.date ?? null,
        estimated_delivery_final: p?.shipping_option?.estimated_delivery_final?.date ?? null,
      },
    };
  });
}

async function getShipmentSlaSnapshot(accessToken, shippingId, cache) {
  if (!shippingId) return null;
  return cachedFetch(cache, `sla:${shippingId}`, async () => {
    const slaResponse = await fetch(
      `https://api.mercadolibre.com/shipments/${shippingId}/sla`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!slaResponse.ok) return null;
    const p = await slaResponse.json();
    return {
      status: p?.status ?? null,
      expected_date: p?.expected_date ?? null,
      service: p?.service ?? null,
      last_updated: p?.last_updated ?? null,
    };
  });
}

function shouldFetchBillingInfo(order, shipmentSnapshot) {
  const orderStatus = String(order?.status || "").toLowerCase();
  const shipmentStatus = String(shipmentSnapshot?.status || "").toLowerCase();
  const shipmentSubstatus = String(shipmentSnapshot?.substatus || "").toLowerCase();

  return (
    ["paid", "confirmed", "pending", "handling", "ready_to_ship"].includes(orderStatus) ||
    ["pending", "handling", "ready_to_ship"].includes(shipmentStatus) ||
    shipmentSubstatus === "invoice_pending"
  );
}

async function getOrderBillingInfoSnapshot(accessToken, orderId, cache) {
  if (!orderId) {
    return { available: false, status: "missing_order_id", data: null };
  }

  return cachedFetch(cache, `billing:${orderId}`, async () => {
    try {
      const billingResponse = await fetch(
        `https://api.mercadolibre.com/orders/${orderId}/billing_info`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-version": "2",
          },
        }
      );

      if (billingResponse.ok) {
        const payload = await billingResponse.json();
        return { available: true, status: "available", data: payload };
      }

      const status =
        billingResponse.status === 401 || billingResponse.status === 403
          ? "forbidden"
          : billingResponse.status === 404
            ? "not_found"
            : "error";
      const details = await billingResponse.text();
      return {
        available: false,
        status,
        data: null,
        error_status: billingResponse.status,
        error_message: details || null,
      };
    } catch (error) {
      return {
        available: false,
        status: "error",
        data: null,
        error_status: 0,
        error_message: error instanceof Error ? error.message : "billing_info_fetch_failed",
      };
    }
  });
}

function buildDepositSnapshot(order, orderItem, shipmentSnapshot, storesById, storesByNodeId) {
  const stock = orderItem?.stock || order?.order_items?.[0]?.stock;
  const storeId = stock?.store_id ? String(stock.store_id) : null;
  const nodeId = stock?.node_id ? String(stock.node_id) : null;
  const logisticType =
    typeof shipmentSnapshot?.logistic_type === "string"
      ? shipmentSnapshot.logistic_type
      : null;

  const matchedStore =
    (storeId && storesById.get(storeId)) ||
    (nodeId && storesByNodeId.get(nodeId)) ||
    null;

  if (matchedStore) {
    return {
      key: `store:${matchedStore.id}`,
      label:
        matchedStore.description ||
        matchedStore.location?.address_line ||
        matchedStore.location?.street_name ||
        `Deposito ${matchedStore.id}`,
      source: "store_search",
      store_id: String(matchedStore.id),
      node_id: matchedStore.network_node_id || nodeId || null,
      logistic_type: logisticType,
      store: {
        id: matchedStore.id,
        description: matchedStore.description || null,
        network_node_id: matchedStore.network_node_id || null,
        services: matchedStore.services || null,
        location: matchedStore.location || null,
      },
    };
  }

  if (logisticType === "fulfillment") {
    return {
      key: "logistic:fulfillment",
      label: "Full",
      source: "logistic_type",
      store_id: null,
      node_id: nodeId,
      logistic_type: logisticType,
      store: null,
    };
  }

  if (nodeId) {
    return {
      key: `node:${nodeId}`,
      label: nodeId,
      source: "node_id",
      store_id: storeId,
      node_id: nodeId,
      logistic_type: logisticType,
      store: null,
    };
  }

  return {
    key: "without-deposit",
    label: "Vendas sem deposito",
    source: "none",
    store_id: storeId,
    node_id: nodeId,
    logistic_type: logisticType,
    store: null,
  };
}

function buildOrdersSearchUrl({
  sellerId,
  dateFrom,
  dateTo,
  statusFilter,
  shippingStatusFilter,
  updatedFrom,
  offset,
}) {
  const params = new URLSearchParams({
    seller: sellerId,
    sort: "date_desc",
    limit: String(ML_PAGE_LIMIT),
    offset: String(offset),
  });

  // Aplica o piso global (MIN_SYNC_DATE_FROM) — mesmo se nenhum dateFrom foi
  // passado, a busca nunca vai alem dessa data. Se passou um dateFrom mais
  // antigo que o piso, clampa pro piso.
  const effectiveDateFrom = clampDateFrom(dateFrom);
  params.set("order.date_created.from", `${effectiveDateFrom}T00:00:00.000-03:00`);

  if (dateTo) {
    params.set("order.date_created.to", `${dateTo}T23:59:59.000-03:00`);
  }

  if (statusFilter) {
    params.set("order.status", statusFilter);
  }

  if (shippingStatusFilter) {
    params.set("shipping.status", shippingStatusFilter);
  }

  if (updatedFrom) {
    params.set("order.date_last_updated.from", updatedFrom);
  }

  return `https://api.mercadolibre.com/orders/search?${params.toString()}`;
}

export async function getConnectionBySellerId(sellerId) {
  return getStoredConnectionBySellerId(sellerId);
}

export async function runMercadoLivreSync({
  connectionId,
  dateFrom,
  dateTo,
  statusFilter,
  shippingStatusFilter,
  updatedFrom,
  pageLimit,
  skipMirrorSync,
  skipLastSyncUpdate,
}) {
  const effectivePageLimit = Number.isFinite(Number(pageLimit))
    ? Math.max(1, Math.min(Number(pageLimit), ABSOLUTE_MAX_PAGES))
    : updatedFrom
      ? DEFAULT_INCREMENTAL_MAX_PAGES
      : DEFAULT_FULL_MAX_PAGES;

  const baseConnection = getConnectionById(connectionId);

  if (!baseConnection?.seller_id) {
    throw new Error("Connection not found");
  }

  let connection = await ensureValidAccessToken(baseConnection);
  const sellerStores = await getSellerStores(connection.access_token, String(connection.seller_id));
  const storesById = new Map();
  const storesByNodeId = new Map();

  for (const store of sellerStores) {
    if (store?.id) storesById.set(String(store.id), store);
    if (store?.network_node_id) storesByNodeId.set(String(store.network_node_id), store);
  }

  const itemImageCache = new Map();
  const shipmentSnapshotCache = new Map();
  const shipmentSlaCache = new Map();
  const billingInfoCache = new Map();

  let offset = 0;
  let pageCount = 0;
  let totalFetched = 0;
  let totalSynced = 0;
  let paging = null;
  const touchedPackIds = new Set();

  while (pageCount < effectivePageLimit) {
    // Refresh token if needed during long syncs
    if (pageCount > 0 && pageCount % 50 === 0) {
      const refreshedConnection = await ensureValidAccessToken(connection);
      if (refreshedConnection.access_token !== connection.access_token) {
        connection = refreshedConnection;
      }
    }

    const ordersUrl = buildOrdersSearchUrl({
      sellerId: String(connection.seller_id),
      dateFrom,
      dateTo,
      statusFilter,
      shippingStatusFilter,
      updatedFrom,
      offset,
    });

    const ordersResponse = await fetch(ordersUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
      },
    });

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text();
      throw new Error(`Falha ao buscar pedidos no Mercado Livre: ${errorText}`);
    }

    const ordersPayload = await ordersResponse.json();
    const pageOrders = Array.isArray(ordersPayload.results) ? ordersPayload.results : [];
    paging = ordersPayload.paging || paging;

    if (pageOrders.length === 0) {
      break;
    }

    // Collect pack IDs before parallel processing
    for (const order of pageOrders) {
      const packId = order.pack_id ? String(order.pack_id) : null;
      if (packId) touchedPackIds.add(packId);
    }

    // Fetch all external data for every order in this page concurrently
    const orderResults = await Promise.all(
      pageOrders.map(async (order) => {
        const orderId = String(order.id);
        const shippingId = order.shipping?.id ? String(order.shipping.id) : null;

        const [shipmentSnapshot, shipmentSlaSnapshot] = await Promise.all([
          getShipmentSnapshot(connection.access_token, shippingId, shipmentSnapshotCache),
          getShipmentSlaSnapshot(connection.access_token, shippingId, shipmentSlaCache),
        ]);

        const billingInfoSnapshot = shouldFetchBillingInfo(order, shipmentSnapshot)
          ? await getOrderBillingInfoSnapshot(connection.access_token, orderId, billingInfoCache)
          : { available: false, status: "skipped", data: null };

        const shipmentReceiverName =
          typeof shipmentSnapshot?.receiver_name === "string"
            ? shipmentSnapshot.receiver_name
            : null;
        const buyerNameFromOrder = order.buyer?.first_name
          ? `${order.buyer.first_name} ${order.buyer.last_name || ""}`.trim()
          : null;
        const buyerName =
          shipmentReceiverName || buyerNameFromOrder || order.buyer?.nickname || null;
        const orderItems = Array.isArray(order.order_items) ? order.order_items : [];

        if (orderItems.length === 0) return null;

        const itemRecords = await Promise.all(
          orderItems.map(async (item, itemIndex) => {
            const itemId = item.item?.id || null;
            const productImageUrl = await getItemImageUrl(
              connection.access_token,
              itemId,
              itemImageCache
            );
            const depositSnapshot = buildDepositSnapshot(
              order,
              item,
              shipmentSnapshot,
              storesById,
              storesByNodeId
            );
            const recordId = `${orderId}:${itemId || item.item?.seller_sku || itemIndex}`;

            const qty = item.quantity || 1;
            const unitPrice = item.unit_price ?? null;
            const fullUnitPrice = item.full_unit_price ?? null;
            const isSingleItem = orderItems.length === 1;
            const currencyId = order.currency_id || null;
            let amount = null;

            // 1) Prefer unit_price * qty (actual sale price, excludes shipping)
            if (unitPrice != null && unitPrice > 0) {
              amount = Number((Math.round(unitPrice * qty * 100) / 100).toFixed(2));
            }
            // 2) Fallback to full_unit_price * qty (pre-discount, still excludes shipping)
            else if (fullUnitPrice != null && fullUnitPrice > 0) {
              amount = Number((Math.round(fullUnitPrice * qty * 100) / 100).toFixed(2));
            }
            // 3) Single-item: total_amount minus shipping cost (total_amount includes shipping)
            else if (isSingleItem && typeof order.total_amount === "number" && order.total_amount > 0) {
              const shippingCost = order.shipping?.cost ?? 0;
              const productAmount = order.total_amount - shippingCost;
              amount = Number((Math.round(Math.max(productAmount, 0) * 100) / 100).toFixed(2));
            }
            // 4) Last resort: proportional distribution of total_amount
            else if (typeof order.total_amount === "number" && order.total_amount > 0) {
              const totalItems = orderItems.reduce((s, it) => s + (it.quantity || 1), 0);
              amount = Number((Math.round((order.total_amount * qty / totalItems) * 100) / 100).toFixed(2));
            }

            return {
              id: recordId,
              connection_id: connection.id,
              order_id: orderId,
              sale_number: orderId,
              sale_date: order.date_created,
              buyer_name: buyerName,
              buyer_nickname: order.buyer?.nickname || null,
              item_title: item.item?.title || null,
              item_id: itemId,
              product_image_url: productImageUrl,
              sku: item.item?.seller_sku || null,
              quantity: qty,
              amount,
              currency_id: currencyId,
              order_status: order.status || null,
              shipping_id: shippingId,
              raw_data: {
                ...order,
                order_item_index: itemIndex,
                order_item_snapshot: item,
                shipment_snapshot: shipmentSnapshot,
                sla_snapshot: shipmentSlaSnapshot,
                deposit_snapshot: depositSnapshot,
                billing_info_snapshot: billingInfoSnapshot.data,
                billing_info_status: billingInfoSnapshot.status,
                billing_info_error_status: billingInfoSnapshot.error_status ?? null,
                billing_info_error_message: billingInfoSnapshot.error_message ?? null,
              },
            };
          })
        );

        return { orderId, records: itemRecords };
      })
    );

    const pageRecords = [];
    const orderIdsToReplace = [];

    for (const result of orderResults) {
      if (!result) continue;
      orderIdsToReplace.push(result.orderId);
      pageRecords.push(...result.records);
    }

    replaceOrdersByOrderIds(orderIdsToReplace, pageRecords);

    totalFetched += pageOrders.length;
    totalSynced += pageRecords.length;
    pageCount += 1;
    offset += pageOrders.length;

    const totalAvailable = Number(ordersPayload?.paging?.total ?? 0);
    if (pageOrders.length < ML_PAGE_LIMIT || (totalAvailable > 0 && offset >= totalAvailable)) {
      break;
    }
  }

  const mirror = {
    packs: null,
    claims: null,
    returns: null,
    warnings: [],
  };

  if (skipMirrorSync) {
    // Active refresh mode: skip mirror sync and last_sync_at update
    invalidateDashboardCache();
    invalidateOrdersCache();
    invalidatePrivateSellerCenterComparisonCache();

    return {
      success: true,
      totalFetched,
      synced: totalSynced,
      pages: pageCount,
      paging,
      mirror,
      connection_last_sync_at: connection.last_sync_at || null,
    };
  }

  const shouldForceMirrorSync = !updatedFrom;
  const shouldRunPacksSync = shouldRunMirrorEntitySync(connection, "packs", {
    force: shouldForceMirrorSync,
  });
  const shouldRunClaimsSync = shouldRunMirrorEntitySync(connection, "claims", {
    force: shouldForceMirrorSync,
  });
  const shouldRunReturnsSync = shouldRunMirrorEntitySync(connection, "returns", {
    force: shouldForceMirrorSync,
  });

  if (shouldRunPacksSync) {
    try {
      mirror.packs = await syncPacks({
        connectionId: connection.id,
        packIds: updatedFrom ? [...touchedPackIds] : undefined,
      });
    } catch (error) {
      mirror.warnings.push({
        entity: "packs",
        error: error instanceof Error ? error.message : "pack_sync_failed",
      });
    }
  } else {
    mirror.packs = {
      ok: true,
      entity: "packs",
      status: "skipped_recent_sync",
      incomplete: false,
      seller_id: String(connection.seller_id),
      fetched: 0,
      synced: 0,
      pages: 0,
      records: [],
    };
  }

  if (shouldRunClaimsSync) {
    try {
      mirror.claims = await syncClaims({
        connectionId: connection.id,
        updatedFrom: updatedFrom || baseConnection.last_sync_at || null,
        pageLimit: effectivePageLimit,
      });
    } catch (error) {
      mirror.warnings.push({
        entity: "claims",
        error: error instanceof Error ? error.message : "claim_sync_failed",
      });
    }
  } else {
    mirror.claims = {
      ok: true,
      entity: "claims",
      status: "skipped_recent_sync",
      incomplete: false,
      seller_id: String(connection.seller_id),
      fetched: 0,
      synced: 0,
      pages: 0,
      records: [],
    };
  }

  if (shouldRunReturnsSync) {
    try {
      mirror.returns = await syncReturns({
        connectionId: connection.id,
        claims: mirror.claims?.status === "synced" ? mirror.claims.records || null : null,
      });
    } catch (error) {
      mirror.warnings.push({
        entity: "returns",
        error: error instanceof Error ? error.message : "return_sync_failed",
      });
    }
  } else {
    mirror.returns = {
      ok: true,
      entity: "returns",
      status: "skipped_recent_sync",
      incomplete: false,
      seller_id: String(connection.seller_id),
      fetched: 0,
      synced: 0,
      pages: 0,
      records: [],
    };
  }

  const updatedConnection = skipLastSyncUpdate
    ? connection
    : updateConnectionLastSync(connection.id);
  invalidateDashboardCache();
  invalidateOrdersCache();
  invalidatePrivateSellerCenterComparisonCache();

  // Notifica todos os clientes SSE conectados que o sync terminou
  broadcastSyncComplete({
    synced: totalSynced,
    fetched: totalFetched,
    pages: pageCount,
  });

  return {
    success: true,
    totalFetched,
    synced: totalSynced,
    pages: pageCount,
    paging,
    mirror,
    connection_last_sync_at: updatedConnection?.last_sync_at || null,
  };
}

// ─── Active Orders Refresh ────────────────────────────────────────────────
// Re-fetches ALL orders in active shipping statuses (ready_to_ship, shipped)
// directly from the ML API. This catches status transitions that incremental
// sync misses (e.g. shipped→delivered, ready_to_ship→shipped).
//
// Runs on a separate timer (every 5 min) from the incremental sync (30s).
// Skips mirror sync and last_sync_at update to avoid interfering with
// the incremental sync cycle.
//
// After this runs, local DB has current data for all active orders,
// making local classification match ML Seller Center exactly.
// Caps generosos pra cobrir pedidos "presos" antigos (NF-e nunca emitida,
// etiqueta nunca impressa) que continuam aparecendo em "Próximos dias" no ML
// Seller Center. Sem isso, sort=date_desc deixa os mais antigos fora do scroll.
// 50 páginas × 50 = 2500 pedidos por status — folga grande sem custo perceptível
// pois ML quebra cedo quando a página retorna < limit.
const ACTIVE_REFRESH_SHIPPING_STATUSES = [
  { status: "pending", maxPages: 50 },
  { status: "ready_to_ship", maxPages: 50 },
  { status: "shipped", maxPages: 10 },
  { status: "not_delivered", maxPages: 5 },
];
// Pedidos recém-entregues/cancelados: atualiza no DB local para limpar
// dados stale (ex: pedido que era shipped/out_for_delivery mas agora
// é delivered — sem esse sync, fica preso como "Em trânsito").
const ACTIVE_REFRESH_RECENT_DELIVERED_DAYS = 3;
const ACTIVE_REFRESH_RECENT_CANCELLED_DAYS = 3;

export async function runActiveOrdersRefresh({ connectionId }) {
  let totalRefreshed = 0;

  // 1. Sync all orders in active shipping statuses
  for (const { status, maxPages } of ACTIVE_REFRESH_SHIPPING_STATUSES) {
    try {
      const result = await runMercadoLivreSync({
        connectionId,
        shippingStatusFilter: status,
        pageLimit: maxPages,
        skipMirrorSync: true,
        skipLastSyncUpdate: true,
      });
      totalRefreshed += result.synced || 0;
    } catch (err) {
      console.error(`[active-refresh] Failed for shipping.status=${status}:`, err.message);
    }
  }

  // 2. Sync recently-delivered orders to clear stale shipped data.
  // Orders that were shipped/out_for_delivery yesterday but got delivered
  // today won't appear in shipping.status=shipped anymore. Without this,
  // they stay as "Em trânsito" in our dashboard forever.
  try {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - ACTIVE_REFRESH_RECENT_DELIVERED_DAYS);
    const updatedFrom = recentDate.toISOString();

    const result = await runMercadoLivreSync({
      connectionId,
      shippingStatusFilter: "delivered",
      updatedFrom,
      pageLimit: 10,
      skipMirrorSync: true,
      skipLastSyncUpdate: true,
    });
    totalRefreshed += result.synced || 0;
  } catch (err) {
    console.error("[active-refresh] Failed for recent delivered:", err.message);
  }

  // 3. Sync recently-cancelled orders to clear stale data.
  // Pedidos cancelados precisam ser atualizados no DB local para que
  // não fiquem presos em ready_to_ship/shipped fantasma.
  try {
    const recentCancelDate = new Date();
    recentCancelDate.setDate(recentCancelDate.getDate() - ACTIVE_REFRESH_RECENT_CANCELLED_DAYS);
    const cancelledFrom = recentCancelDate.toISOString();

    const result = await runMercadoLivreSync({
      connectionId,
      statusFilter: "cancelled",
      updatedFrom: cancelledFrom,
      pageLimit: 5,
      skipMirrorSync: true,
      skipLastSyncUpdate: true,
    });
    totalRefreshed += result.synced || 0;
  } catch (err) {
    console.error("[active-refresh] Failed for recent cancelled:", err.message);
  }

  invalidateDashboardCache();
  return { success: true, totalRefreshed };
}

// ─── Hard Heal: Re-fetch specific order IDs from ML API ──────────────────
// Usado pelo autoHealDrift quando drift persiste (bug de classificação ou
// dados corrompidos em pedidos específicos). Em vez de refazer busca por
// status (active refresh), vai DIRETO em /orders/{id} e /shipments/{id}
// pra garantir que o raw_data do DB seja idêntico ao que o ML retorna AGORA.
//
// Diferente do runMercadoLivreSync (que pagina por filtros), este busca
// lista específica de order IDs em paralelo, em chunks de até 10.
//
// Retorna { success, totalRefreshed, errors, attempted }.
const REFRESH_BY_IDS_CONCURRENCY = 10;

export async function refreshMLOrdersByIds({ connectionId, orderIds }) {
  const ids = Array.isArray(orderIds)
    ? [...new Set(orderIds.map((v) => String(v).trim()).filter(Boolean))]
    : [];
  if (ids.length === 0) {
    return { success: true, totalRefreshed: 0, attempted: 0, errors: [] };
  }

  const baseConnection = getConnectionById(connectionId);
  if (!baseConnection?.seller_id) {
    return {
      success: false,
      totalRefreshed: 0,
      attempted: ids.length,
      errors: [{ order_id: null, message: "Connection not found" }],
    };
  }

  let connection = await ensureValidAccessToken(baseConnection);
  const sellerStores = await getSellerStores(
    connection.access_token,
    String(connection.seller_id)
  );
  const storesById = new Map();
  const storesByNodeId = new Map();
  for (const store of sellerStores) {
    if (store?.id) storesById.set(String(store.id), store);
    if (store?.network_node_id) storesByNodeId.set(String(store.network_node_id), store);
  }

  const itemImageCache = new Map();
  const shipmentSnapshotCache = new Map();
  const shipmentSlaCache = new Map();
  const billingInfoCache = new Map();

  const errors = [];
  let totalRefreshed = 0;

  // Processa em chunks de REFRESH_BY_IDS_CONCURRENCY com fetch paralelo
  for (let i = 0; i < ids.length; i += REFRESH_BY_IDS_CONCURRENCY) {
    const chunk = ids.slice(i, i + REFRESH_BY_IDS_CONCURRENCY);

    // 1. GET /orders/{id} pra cada ID do chunk
    const orderResults = await Promise.all(
      chunk.map(async (orderId) => {
        try {
          const r = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
            headers: { Authorization: `Bearer ${connection.access_token}` },
          });
          if (!r.ok) {
            const text = await r.text().catch(() => "");
            errors.push({
              order_id: orderId,
              message: `GET /orders/${orderId} → ${r.status}: ${text.slice(0, 200)}`,
            });
            return null;
          }
          return await r.json();
        } catch (err) {
          errors.push({
            order_id: orderId,
            message: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      })
    );

    const validOrders = orderResults.filter((o) => o && o.id);
    if (validOrders.length === 0) continue;

    // 2. Pra cada order, busca shipment + sla + billing em paralelo
    const chunkRecords = await Promise.all(
      validOrders.map(async (order) => {
        try {
          const orderId = String(order.id);
          const shippingId = order.shipping?.id ? String(order.shipping.id) : null;

          const [shipmentSnapshot, shipmentSlaSnapshot] = await Promise.all([
            getShipmentSnapshot(connection.access_token, shippingId, shipmentSnapshotCache),
            getShipmentSlaSnapshot(connection.access_token, shippingId, shipmentSlaCache),
          ]);

          const billingInfoSnapshot = shouldFetchBillingInfo(order, shipmentSnapshot)
            ? await getOrderBillingInfoSnapshot(
                connection.access_token,
                orderId,
                billingInfoCache
              )
            : { available: false, status: "skipped", data: null };

          const shipmentReceiverName =
            typeof shipmentSnapshot?.receiver_name === "string"
              ? shipmentSnapshot.receiver_name
              : null;
          const buyerNameFromOrder = order.buyer?.first_name
            ? `${order.buyer.first_name} ${order.buyer.last_name || ""}`.trim()
            : null;
          const buyerName =
            shipmentReceiverName || buyerNameFromOrder || order.buyer?.nickname || null;
          const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
          if (orderItems.length === 0) return [];

          const itemRecords = await Promise.all(
            orderItems.map(async (item, itemIndex) => {
              const itemId = item.item?.id || null;
              const productImageUrl = await getItemImageUrl(
                connection.access_token,
                itemId,
                itemImageCache
              );
              const depositSnapshot = buildDepositSnapshot(
                order,
                item,
                shipmentSnapshot,
                storesById,
                storesByNodeId
              );
              const recordId = `${orderId}:${itemId || item.item?.seller_sku || itemIndex}`;

              const qty = item.quantity || 1;
              const unitPrice = item.unit_price ?? null;
              const fullUnitPrice = item.full_unit_price ?? null;
              const isSingleItem = orderItems.length === 1;
              const currencyId = order.currency_id || null;
              let amount = null;
              if (unitPrice != null && unitPrice > 0) {
                amount = Number((Math.round(unitPrice * qty * 100) / 100).toFixed(2));
              } else if (fullUnitPrice != null && fullUnitPrice > 0) {
                amount = Number((Math.round(fullUnitPrice * qty * 100) / 100).toFixed(2));
              } else if (
                isSingleItem &&
                typeof order.total_amount === "number" &&
                order.total_amount > 0
              ) {
                const shippingCost = order.shipping?.cost ?? 0;
                const productAmount = order.total_amount - shippingCost;
                amount = Number(
                  (Math.round(Math.max(productAmount, 0) * 100) / 100).toFixed(2)
                );
              } else if (typeof order.total_amount === "number" && order.total_amount > 0) {
                const totalItems = orderItems.reduce((s, it) => s + (it.quantity || 1), 0);
                amount = Number(
                  (Math.round((order.total_amount * qty / totalItems) * 100) / 100).toFixed(2)
                );
              }

              return {
                id: recordId,
                connection_id: connection.id,
                order_id: orderId,
                sale_number: orderId,
                sale_date: order.date_created,
                buyer_name: buyerName,
                buyer_nickname: order.buyer?.nickname || null,
                item_title: item.item?.title || null,
                item_id: itemId,
                product_image_url: productImageUrl,
                sku: item.item?.seller_sku || null,
                quantity: qty,
                amount,
                currency_id: currencyId,
                order_status: order.status || null,
                shipping_id: shippingId,
                raw_data: {
                  ...order,
                  order_item_index: itemIndex,
                  order_item_snapshot: item,
                  shipment_snapshot: shipmentSnapshot,
                  sla_snapshot: shipmentSlaSnapshot,
                  deposit_snapshot: depositSnapshot,
                  billing_info_snapshot: billingInfoSnapshot.data,
                  billing_info_status: billingInfoSnapshot.status,
                  billing_info_error_status: billingInfoSnapshot.error_status ?? null,
                  billing_info_error_message: billingInfoSnapshot.error_message ?? null,
                },
              };
            })
          );
          return itemRecords;
        } catch (err) {
          errors.push({
            order_id: String(order.id),
            message: err instanceof Error ? err.message : String(err),
          });
          return [];
        }
      })
    );

    // 3. Flatten + upsert (substitui registros antigos pra garantir que
    //    items removidos do pedido também saem do DB). upsertOrders já faz
    //    JSON.stringify no raw_data — aqui passamos como objeto mesmo.
    const flatRecords = chunkRecords.flat().filter(Boolean);
    if (flatRecords.length > 0) {
      const orderIdsInChunk = [...new Set(flatRecords.map((r) => r.order_id))];
      try {
        replaceOrdersByOrderIds(orderIdsInChunk, flatRecords);
        totalRefreshed += orderIdsInChunk.length;
      } catch (err) {
        errors.push({
          order_id: orderIdsInChunk.join(","),
          message: `upsert: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Invalida caches pra que próxima leitura veja dados frescos
  invalidateDashboardCache();
  invalidateOrdersCache();

  return {
    success: errors.length === 0 || totalRefreshed > 0,
    totalRefreshed,
    attempted: ids.length,
    errors,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const {
      connection_id,
      date_from,
      date_to,
      status_filter,
      updated_from,
      page_limit,
    } = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};

    if (!connection_id) {
      return response.status(400).json({ success: false, error: "connection_id is required" });
    }

    const connection = getConnectionById(connection_id);
    if (!connection?.id) {
      return response.status(404).json({
        success: false,
        error: "Connection not found",
      });
    }

    if (shouldSkipIncrementalSync(connection, updated_from)) {
      return response.status(200).json({
        success: true,
        total_fetched: 0,
        synced: 0,
        pages: 0,
        paging: null,
        mirror: null,
        skipped: true,
        connection_last_sync_at: connection.last_sync_at || null,
      });
    }

    let syncPromise = syncRequestsInFlight.get(connection_id);
    if (!syncPromise) {
      syncPromise = runMercadoLivreSync({
        connectionId: connection_id,
        dateFrom: date_from,
        dateTo: date_to,
        statusFilter: status_filter,
        updatedFrom: updated_from,
        pageLimit: page_limit,
      }).finally(() => {
        if (syncRequestsInFlight.get(connection_id) === syncPromise) {
          syncRequestsInFlight.delete(connection_id);
        }
      });

      syncRequestsInFlight.set(connection_id, syncPromise);
    }

    const result = await syncPromise;

    return response.status(200).json({
      success: true,
      total_fetched: result.totalFetched,
      synced: result.synced,
      pages: result.pages,
      paging: result.paging,
      mirror: result.mirror,
      skipped: false,
      connection_last_sync_at: result.connection_last_sync_at || null,
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
