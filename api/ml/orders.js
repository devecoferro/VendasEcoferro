import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  countOrdersByScope,
  getOperationalOrders,
  getOrders,
  getOrderSummariesByScope,
  getPaginatedOrderRows,
  getPaginatedOrderSummaries,
} from "./_lib/storage.js";
import { getEmittedInvoiceLookup } from "./_lib/document-storage.js";

const OPEN_STATUSES = new Set(["pending", "handling", "ready_to_ship", "confirmed", "paid"]);
const TRANSIT_STATUSES = new Set(["shipped", "in_transit"]);
const DELIVERED_STATUSES = new Set(["delivered"]);
const FINAL_EXCEPTION_STATUSES = new Set(["cancelled", "not_delivered", "returned"]);
const ORDERS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAGINATION_LIMIT = 300;
const MAX_PAGINATION_LIMIT = 1000;
const CLIENT_RAW_DATA_KEYS = [
  "status",
  "payments",
  "tags",
  "context",
  "shipment_snapshot",
  "sla_snapshot",
  "deposit_snapshot",
  "billing_info_status",
  "billing_info_snapshot",
  "shipping_id",
  "__nfe_emitted",
];

const ordersCache = new Map();

export function invalidateOrdersCache() {
  ordersCache.clear();
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeState(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOrderItem(row) {
  return {
    item_title: row?.item_title ?? null,
    sku: row?.sku ?? null,
    quantity: toFiniteNumber(row?.quantity, 0),
    amount: row?.amount == null ? null : toFiniteNumber(row.amount, 0),
    item_id: row?.item_id ?? null,
    product_image_url: row?.product_image_url ?? null,
  };
}

function buildOrderTitle(items) {
  const titledItems = items
    .map((item) => item.item_title)
    .filter((title) => typeof title === "string" && title.trim().length > 0);

  if (titledItems.length === 0) {
    return null;
  }

  if (titledItems.length === 1) {
    return titledItems[0];
  }

  return `${titledItems[0]} + ${titledItems.length - 1} item(ns)`;
}

function buildOrderSku(items) {
  const uniqueSkus = [...new Set(items.map((item) => item.sku).filter(Boolean))];

  if (uniqueSkus.length === 0) {
    return null;
  }

  return uniqueSkus[0];
}

function pickClientRawData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return {};
  }

  const payload = {};

  for (const key of CLIENT_RAW_DATA_KEYS) {
    if (rawData[key] !== undefined) {
      payload[key] = rawData[key];
    }
  }

  if (
    rawData.shipping &&
    typeof rawData.shipping === "object" &&
    (rawData.shipping.id != null || rawData.shipping.status != null)
  ) {
    payload.shipping = {
      id: rawData.shipping.id ?? null,
      status: rawData.shipping.status ?? null,
    };
  }

  return payload;
}

function pickDashboardRawData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return {};
  }

  const payload = {};

  if (rawData.status !== undefined) {
    payload.status = rawData.status;
  }

  // tags e context.flows: apenas o booleano que o frontend precisa
  // para detectar buyer type (negócio vs pessoa). Evita enviar arrays inteiros.
  if (Array.isArray(rawData.tags)) {
    payload.tags = rawData.tags;
  }

  if (rawData.billing_info_status !== undefined) {
    payload.billing_info_status = rawData.billing_info_status;
  }

  // payments: só precisa saber se tem approved — envia flag ao invés de array
  const hasApprovedPayment = Array.isArray(rawData.payments) &&
    rawData.payments.some((p) => p?.status === "approved");
  payload.payments = hasApprovedPayment ? [{ status: "approved" }] : [];

  if (rawData.context && typeof rawData.context === "object") {
    payload.context = {
      flows: Array.isArray(rawData.context.flows) ? rawData.context.flows : [],
    };
  }

  if (rawData.deposit_snapshot && typeof rawData.deposit_snapshot === "object") {
    payload.deposit_snapshot = {
      key: rawData.deposit_snapshot.key ?? null,
      label: rawData.deposit_snapshot.label ?? null,
      logistic_type: rawData.deposit_snapshot.logistic_type ?? null,
    };
  }

  if (rawData.sla_snapshot && typeof rawData.sla_snapshot === "object") {
    payload.sla_snapshot = {
      expected_date: rawData.sla_snapshot.expected_date ?? null,
      status: rawData.sla_snapshot.status ?? null,
    };
  }

  if (rawData.__nfe_emitted === true) {
    payload.__nfe_emitted = true;
  }

  if (rawData.shipment_snapshot && typeof rawData.shipment_snapshot === "object") {
    payload.shipment_snapshot = {
      status: rawData.shipment_snapshot.status ?? null,
      substatus: rawData.shipment_snapshot.substatus ?? null,
      logistic_type: rawData.shipment_snapshot.logistic_type ?? null,
      status_history:
        rawData.shipment_snapshot.status_history &&
        typeof rawData.shipment_snapshot.status_history === "object"
          ? {
              date_handling: rawData.shipment_snapshot.status_history.date_handling ?? null,
              date_ready_to_ship:
                rawData.shipment_snapshot.status_history.date_ready_to_ship ?? null,
              date_shipped: rawData.shipment_snapshot.status_history.date_shipped ?? null,
              date_cancelled: rawData.shipment_snapshot.status_history.date_cancelled ?? null,
              date_returned: rawData.shipment_snapshot.status_history.date_returned ?? null,
              date_not_delivered:
                rawData.shipment_snapshot.status_history.date_not_delivered ?? null,
            }
          : null,
      shipping_option:
        rawData.shipment_snapshot.shipping_option &&
        typeof rawData.shipment_snapshot.shipping_option === "object"
          ? {
              estimated_delivery_limit:
                rawData.shipment_snapshot.shipping_option.estimated_delivery_limit ?? null,
              estimated_delivery_final:
                rawData.shipment_snapshot.shipping_option.estimated_delivery_final ?? null,
            }
          : null,
    };
  }

  return payload;
}

function enrichOrdersWithEmittedInvoiceFlag(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;

  const sellerLookups = new Map();

  for (const order of orders) {
    const rawData = order.raw_data || {};
    const sellerId =
      rawData.seller_id ||
      rawData.seller?.id ||
      order.seller_id ||
      rawData.shipment_snapshot?.seller_id;
    if (!sellerId) continue;

    const sellerKey = String(sellerId);
    if (!sellerLookups.has(sellerKey)) {
      sellerLookups.set(sellerKey, getEmittedInvoiceLookup(sellerKey));
    }
    const lookup = sellerLookups.get(sellerKey);

    const orderId = order.order_id ? String(order.order_id) : null;
    const shipmentId =
      rawData.shipment_snapshot?.id ||
      rawData.shipping_id ||
      order.shipping_id;
    const packId = rawData.pack_id;

    const hasNfe =
      (orderId && lookup.orderIds.has(orderId)) ||
      (shipmentId && lookup.shipmentIds.has(String(shipmentId))) ||
      (packId && lookup.packIds.has(String(packId)));

    if (hasNfe) {
      order.raw_data = { ...rawData, __nfe_emitted: true };
    }
  }
}

function sanitizeOrderForClient(order) {
  return {
    ...order,
    raw_data: pickClientRawData(order.raw_data),
  };
}

function shapeOrderForView(order, view = "full") {
  const sanitizedOrder = sanitizeOrderForClient(order);

  if (view !== "dashboard") {
    return sanitizedOrder;
  }

  return {
    id: sanitizedOrder.id,
    order_id: sanitizedOrder.order_id,
    sale_number: sanitizedOrder.sale_number,
    sale_date: sanitizedOrder.sale_date,
    buyer_name: sanitizedOrder.buyer_name,
    buyer_nickname: sanitizedOrder.buyer_nickname,
    item_title: sanitizedOrder.item_title,
    item_id: sanitizedOrder.item_id,
    product_image_url: sanitizedOrder.product_image_url,
    sku: sanitizedOrder.sku,
    quantity: sanitizedOrder.quantity,
    amount: sanitizedOrder.amount,
    order_status: sanitizedOrder.order_status,
    raw_data: pickDashboardRawData(sanitizedOrder.raw_data),
    items: sanitizedOrder.items || [],
  };
}

function isOperationalOrder(order) {
  const shipmentSnapshot =
    order?.raw_data && typeof order.raw_data === "object"
      ? order.raw_data.shipment_snapshot || {}
      : {};
  const status = normalizeState(shipmentSnapshot.status || order.order_status);
  return (
    OPEN_STATUSES.has(status) ||
    TRANSIT_STATUSES.has(status) ||
    DELIVERED_STATUSES.has(status) ||
    FINAL_EXCEPTION_STATUSES.has(status)
  );
}

function getCacheKey({ limit, offset = 0, scope, view }) {
  return `${scope || "all"}:${view || "full"}:${limit == null ? "all" : limit}:${offset}`;
}

function readOrdersCache(key) {
  const cached = ordersCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    ordersCache.delete(key);
    return null;
  }

  return cached.payload;
}

function writeOrdersCache(key, payload) {
  ordersCache.set(key, {
    payload,
    expiresAt: Date.now() + ORDERS_CACHE_TTL_MS,
  });
}

export function consolidateOrders(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const groupedOrders = new Map();

  for (const row of rows) {
    const orderId = String(row?.order_id ?? "").trim();
    if (!orderId) {
      continue;
    }

    const item = normalizeOrderItem(row);
    const existingOrder = groupedOrders.get(orderId);

    if (existingOrder) {
      existingOrder.items.push(item);
      existingOrder.quantity += item.quantity;
      existingOrder.amount += item.amount ?? 0;
      continue;
    }

    groupedOrders.set(orderId, {
      id: row.id,
      order_id: orderId,
      sale_number: row.sale_number ?? orderId,
      sale_date: row.sale_date ?? null,
      buyer_name: row.buyer_name ?? null,
      buyer_nickname: row.buyer_nickname ?? null,
      item_title: row.item_title ?? null,
      item_id: row.item_id ?? null,
      product_image_url: row.product_image_url ?? null,
      sku: row.sku ?? null,
      quantity: item.quantity,
      amount: item.amount ?? 0,
      order_status: row.order_status ?? null,
      raw_data:
        row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {},
      items: [item],
    });
  }

  return Array.from(groupedOrders.values()).map((order) => {
    const primaryItem =
      order.items.find((item) => item.product_image_url || item.item_title || item.sku) ||
      order.items[0];
    const totalAmount = Number(order.amount || 0);

    return {
      ...order,
      item_title: buildOrderTitle(order.items) ?? primaryItem?.item_title ?? order.item_title,
      item_id: primaryItem?.item_id ?? order.item_id,
      product_image_url: primaryItem?.product_image_url ?? order.product_image_url ?? null,
      sku: buildOrderSku(order.items) ?? primaryItem?.sku ?? order.sku,
      quantity: order.quantity,
      amount: totalAmount > 0 ? Number(totalAmount.toFixed(2)) : null,
      raw_data:
        order.raw_data && typeof order.raw_data === "object"
          ? {
              ...order.raw_data,
              grouped_items_count: order.items.length,
              grouped_quantity_total: order.quantity,
            }
          : order.raw_data,
    };
  });
}

function sanitizePaginationLimit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_PAGINATION_LIMIT;
  }

  return Math.max(1, Math.min(Math.trunc(numericValue), MAX_PAGINATION_LIMIT));
}

function sanitizePaginationOffset(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numericValue));
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const scope = String(request.query.scope || "all").trim().toLowerCase();
    const hasExplicitLimit =
      request.query.limit != null && String(request.query.limit).trim() !== "";
    const hasExplicitOffset =
      request.query.offset != null && String(request.query.offset).trim() !== "";
    const limit = hasExplicitLimit
      ? sanitizePaginationLimit(request.query.limit)
      : null;
    const offset = hasExplicitOffset ? sanitizePaginationOffset(request.query.offset) : 0;
    const view = String(request.query.view || "full").trim().toLowerCase();
    const cacheKey = getCacheKey({ limit, offset, scope, view });
    const cachedPayload = readOrdersCache(cacheKey);
    if (cachedPayload) {
      return response.status(200).json(cachedPayload);
    }

    const shouldPaginate = limit != null || hasExplicitOffset;
    const isDashboardView = view === "dashboard";
    const scopedOrders = isDashboardView
      ? shouldPaginate
        ? getPaginatedOrderSummaries({
            scope,
            limit: limit ?? DEFAULT_PAGINATION_LIMIT,
            offset,
          })
        : getOrderSummariesByScope(scope)
      : (() => {
          const rows = shouldPaginate
            ? getPaginatedOrderRows({
                scope,
                limit: limit ?? DEFAULT_PAGINATION_LIMIT,
                offset,
              })
            : scope === "operational"
              ? getOperationalOrders()
              : getOrders();
          const consolidatedOrders = consolidateOrders(rows);
          return shouldPaginate
            ? consolidatedOrders
            : scope === "operational"
              ? consolidatedOrders.filter(isOperationalOrder)
              : consolidatedOrders;
        })();
    enrichOrdersWithEmittedInvoiceFlag(scopedOrders);
    const clientOrders = scopedOrders.map((order) => shapeOrderForView(order, view));
    const totalOrders = shouldPaginate ? countOrdersByScope(scope) : clientOrders.length;
    const effectiveLimit = limit ?? clientOrders.length;
    const nextOffset =
      shouldPaginate && offset + clientOrders.length < totalOrders
        ? offset + clientOrders.length
        : null;
    const payload = {
      orders: clientOrders,
      pagination: {
        offset,
        limit: effectiveLimit,
        total: totalOrders,
        loaded: shouldPaginate
          ? Math.min(offset + clientOrders.length, totalOrders)
          : clientOrders.length,
        has_more: nextOffset != null,
        next_offset: nextOffset,
      },
    };

    writeOrdersCache(cacheKey, payload);

    return response.status(200).json(payload);
  } catch (error) {
    return response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
