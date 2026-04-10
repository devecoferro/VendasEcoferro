import { ensureValidAccessToken } from "./mercado-livre.js";
import { getConnectionById, getLatestConnection, getOrders } from "./storage.js";
import {
  getSellerCenterMirrorOverview,
  listMirrorEntities,
  upsertMirrorEntities,
} from "./mirror-storage.js";

const ML_API_BASE_URL = "https://api.mercadolibre.com";
const SEARCH_PAGE_LIMIT = 50;
const DEFAULT_INCREMENTAL_MAX_PAGES = 10;
const DEFAULT_FULL_MAX_PAGES = 40;
const ABSOLUTE_MAX_PAGES = 80;

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveConnection(requestedConnectionId = null) {
  const latestConnection = getLatestConnection();

  if (!latestConnection?.id) {
    return null;
  }

  if (!requestedConnectionId || requestedConnectionId === latestConnection.id) {
    return latestConnection;
  }

  return getConnectionById(requestedConnectionId);
}

function toAbsoluteApiUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }

  if (pathname.startsWith("/")) {
    return `${ML_API_BASE_URL}${pathname}`;
  }

  return `${ML_API_BASE_URL}/${pathname}`;
}

async function fetchMercadoLivreJson(accessToken, pathname, options = {}) {
  const response = await fetch(toAbsoluteApiUrl(pathname), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (options.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(
      `Mercado Livre API error ${response.status} for ${pathname}: ${details || "empty response"}`
    );
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

function resolveEffectivePageLimit(pageLimit, updatedFrom) {
  return Number.isFinite(Number(pageLimit))
    ? Math.max(1, Math.min(Number(pageLimit), ABSOLUTE_MAX_PAGES))
    : updatedFrom
      ? DEFAULT_INCREMENTAL_MAX_PAGES
      : DEFAULT_FULL_MAX_PAGES;
}

function buildClaimsSearchUrl({ sellerId, offset, updatedFrom, limit = SEARCH_PAGE_LIMIT }) {
  const params = new URLSearchParams({
    player_role: "respondent",
    player_user_id: String(sellerId),
    limit: String(limit),
    offset: String(offset),
  });

  if (updatedFrom) {
    params.set("range", `last_updated:after:${updatedFrom}`);
  }

  return `/post-purchase/v1/claims/search?${params.toString()}`;
}

function extractPagedResults(payload) {
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.claims)) {
    return payload.claims;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
}

function buildOrderReferenceIndex(connectionId) {
  const rows = getOrders();
  const ordersById = new Map();
  const ordersByShipmentId = new Map();
  const ordersByPackId = new Map();

  for (const row of rows) {
    if (row.connection_id !== connectionId) {
      continue;
    }

    const rawData = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
    const orderId = normalizeNullable(row.order_id);
    if (!orderId) {
      continue;
    }

    if (!ordersById.has(orderId)) {
      const shipmentId =
        normalizeNullable(row.shipping_id) ||
        normalizeNullable(rawData.shipping_id) ||
        normalizeNullable(rawData.shipping?.id);
      const packId = normalizeNullable(rawData.pack_id);
      const depositSnapshot =
        rawData.deposit_snapshot && typeof rawData.deposit_snapshot === "object"
          ? rawData.deposit_snapshot
          : {};
      const shipmentSnapshot =
        rawData.shipment_snapshot && typeof rawData.shipment_snapshot === "object"
          ? rawData.shipment_snapshot
          : {};

      const reference = {
        order_id: orderId,
        shipment_id: shipmentId,
        pack_id: packId,
        logistic_type:
          normalizeNullable(depositSnapshot.logistic_type) ||
          normalizeNullable(shipmentSnapshot.logistic_type),
        deposit_key: normalizeNullable(depositSnapshot.key),
        deposit_label: normalizeNullable(depositSnapshot.label),
      };

      ordersById.set(orderId, reference);

      if (shipmentId && !ordersByShipmentId.has(shipmentId)) {
        ordersByShipmentId.set(shipmentId, reference);
      }

      if (packId) {
        if (!ordersByPackId.has(packId)) {
          ordersByPackId.set(packId, []);
        }
        ordersByPackId.get(packId).push(reference);
      }
    }
  }

  return {
    ordersById,
    ordersByShipmentId,
    ordersByPackId,
  };
}

function resolveResourceIdsFromPayload(payload) {
  const orderIds = new Set();
  const shipmentIds = new Set();
  const packIds = new Set();

  function visit(value, contextKey = "") {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, contextKey);
      }
      return;
    }

    const normalizedContext = normalizeStatus(contextKey);
    const resourceType = normalizeStatus(value.resource || value.type || normalizedContext);
    const resourceId = normalizeNullable(value.resource_id || value.id || value.external_id);

    if (normalizeNullable(value.order_id)) {
      orderIds.add(String(value.order_id));
    }

    if (normalizeNullable(value.shipment_id)) {
      shipmentIds.add(String(value.shipment_id));
    }

    if (normalizeNullable(value.pack_id)) {
      packIds.add(String(value.pack_id));
    }

    if (resourceId) {
      if (resourceType.includes("order")) {
        orderIds.add(resourceId);
      } else if (resourceType.includes("shipment")) {
        shipmentIds.add(resourceId);
      } else if (resourceType.includes("pack")) {
        packIds.add(resourceId);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (["order_id", "shipment_id", "pack_id", "resource_id", "resource", "type", "id"].includes(key)) {
        continue;
      }
      visit(child, key);
    }
  }

  visit(payload);

  return {
    order_id: orderIds.values().next().value || null,
    shipment_id: shipmentIds.values().next().value || null,
    pack_id: packIds.values().next().value || null,
  };
}

function resolveReferenceIds(payload, orderIndex) {
  const ids = resolveResourceIdsFromPayload(payload);

  if (ids.order_id && orderIndex.ordersById.has(ids.order_id)) {
    const orderRef = orderIndex.ordersById.get(ids.order_id);
    return {
      order_id: ids.order_id,
      shipment_id: ids.shipment_id || orderRef?.shipment_id || null,
      pack_id: ids.pack_id || orderRef?.pack_id || null,
    };
  }

  if (ids.shipment_id && orderIndex.ordersByShipmentId.has(ids.shipment_id)) {
    const orderRef = orderIndex.ordersByShipmentId.get(ids.shipment_id);
    return {
      order_id: ids.order_id || orderRef?.order_id || null,
      shipment_id: ids.shipment_id,
      pack_id: ids.pack_id || orderRef?.pack_id || null,
    };
  }

  if (ids.pack_id && orderIndex.ordersByPackId.has(ids.pack_id)) {
    const orderRef = orderIndex.ordersByPackId.get(ids.pack_id)?.[0] || null;
    return {
      order_id: ids.order_id || orderRef?.order_id || null,
      shipment_id: ids.shipment_id || orderRef?.shipment_id || null,
      pack_id: ids.pack_id,
    };
  }

  return ids;
}

function normalizeClaimRecord(detailPayload, connection, orderIndex) {
  const references = resolveReferenceIds(detailPayload, orderIndex);

  return {
    connection_id: connection.id,
    seller_id: String(connection.seller_id),
    external_id: normalizeNullable(detailPayload.id),
    order_id: normalizeNullable(references.order_id),
    shipment_id: normalizeNullable(references.shipment_id),
    pack_id: normalizeNullable(references.pack_id),
    raw_status: normalizeNullable(detailPayload.status),
    raw_payload: detailPayload,
    resource_created_at:
      normalizeNullable(detailPayload.date_created) ||
      normalizeNullable(detailPayload.created_at),
    resource_updated_at:
      normalizeNullable(detailPayload.last_updated) ||
      normalizeNullable(detailPayload.date_last_updated),
    last_synced_at: nowIso(),
  };
}

function normalizeReturnRecords(returnPayload, claimRecord, connection, orderIndex) {
  const payloads = Array.isArray(returnPayload)
    ? returnPayload
    : Array.isArray(returnPayload?.results)
      ? returnPayload.results
      : Array.isArray(returnPayload?.returns)
        ? returnPayload.returns
        : returnPayload && typeof returnPayload === "object"
          ? [returnPayload]
          : [];

  const records = [];

  for (const payload of payloads) {
    const references = resolveReferenceIds(payload, orderIndex);

    records.push({
      connection_id: connection.id,
      seller_id: String(connection.seller_id),
      external_id:
        normalizeNullable(payload.id) ||
        normalizeNullable(payload.return_id) ||
        normalizeNullable(payload.external_id),
      order_id:
        normalizeNullable(references.order_id) || normalizeNullable(claimRecord?.order_id),
      shipment_id:
        normalizeNullable(references.shipment_id) || normalizeNullable(claimRecord?.shipment_id),
      pack_id:
        normalizeNullable(references.pack_id) || normalizeNullable(claimRecord?.pack_id),
      raw_status: normalizeNullable(payload.status),
      raw_payload: payload,
      resource_created_at:
        normalizeNullable(payload.date_created) ||
        normalizeNullable(payload.created_at),
      resource_updated_at:
        normalizeNullable(payload.last_updated) ||
        normalizeNullable(payload.date_last_updated),
      last_synced_at: nowIso(),
    });
  }

  return records.filter((record) => record.external_id);
}

function normalizePackRecord(packPayload, connection, orderIndex, requestedPackId) {
  const references = resolveReferenceIds(packPayload, orderIndex);
  const normalizedPackId =
    normalizeNullable(packPayload?.id) || normalizeNullable(requestedPackId);
  const orders = Array.isArray(packPayload?.orders) ? packPayload.orders : [];
  const singleOrderId =
    orders.length === 1
      ? normalizeNullable(orders[0]?.id || orders[0]?.order_id || orders[0])
      : normalizeNullable(references.order_id);

  return {
    connection_id: connection.id,
    seller_id: String(connection.seller_id),
    external_id: normalizedPackId,
    order_id: singleOrderId,
    shipment_id:
      normalizeNullable(packPayload?.shipment?.id) || normalizeNullable(references.shipment_id),
    pack_id: normalizedPackId,
    raw_status: normalizeNullable(packPayload?.status),
    raw_payload: packPayload,
    resource_created_at:
      normalizeNullable(packPayload?.date_created) ||
      normalizeNullable(packPayload?.created_at),
    resource_updated_at:
      normalizeNullable(packPayload?.last_updated) ||
      normalizeNullable(packPayload?.date_last_updated),
    last_synced_at: nowIso(),
  };
}

async function withAuthorizedConnection(options = {}) {
  const baseConnection = resolveConnection(options.connectionId);
  if (!baseConnection?.id || !baseConnection?.seller_id) {
    throw new Error("Conexao do Mercado Livre nao encontrada.");
  }

  const connection = await ensureValidAccessToken(baseConnection);

  return {
    connection,
    orderIndex: buildOrderReferenceIndex(connection.id),
    sellerId: String(connection.seller_id),
  };
}

async function fetchClaimsSearchPage(accessToken, url, { allowFallbackWithoutRange = false } = {}) {
  try {
    return await fetchMercadoLivreJson(accessToken, url);
  } catch (error) {
    if (
      allowFallbackWithoutRange &&
      error instanceof Error &&
      Number(error.statusCode || 0) === 400 &&
      url.includes("range=")
    ) {
      const parsed = new URL(toAbsoluteApiUrl(url));
      parsed.searchParams.delete("range");
      return fetchMercadoLivreJson(accessToken, parsed.toString());
    }

    throw error;
  }
}

export async function syncClaims(options = {}) {
  const { connection, orderIndex, sellerId } = await withAuthorizedConnection(options);
  const updatedFrom = normalizeNullable(options.updatedFrom) || normalizeNullable(connection.last_sync_at);
  const maxPages = resolveEffectivePageLimit(options.pageLimit, updatedFrom);

  let offset = 0;
  let pages = 0;
  let fetched = 0;
  const records = [];

  while (pages < maxPages) {
    const url = buildClaimsSearchUrl({
      sellerId,
      offset,
      updatedFrom,
      limit: SEARCH_PAGE_LIMIT,
    });
    const payload = await fetchClaimsSearchPage(connection.access_token, url, {
      allowFallbackWithoutRange: Boolean(updatedFrom),
    });
    const items = extractPagedResults(payload);

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const claimId =
        normalizeNullable(item?.id) ||
        normalizeNullable(item?.claim_id) ||
        normalizeNullable(item?.resource_id);
      if (!claimId) {
        continue;
      }

      const detail = await fetchMercadoLivreJson(
        connection.access_token,
        `/post-purchase/v1/claims/${claimId}`
      );
      const record = normalizeClaimRecord(detail, connection, orderIndex);
      if (record.external_id) {
        records.push(record);
      }
    }

    fetched += items.length;
    pages += 1;
    offset += items.length;

    if (items.length < SEARCH_PAGE_LIMIT) {
      break;
    }
  }

  const synced = upsertMirrorEntities("claims", records);

  return {
    ok: true,
    entity: "claims",
    status: "synced",
    incomplete: false,
    seller_id: sellerId,
    fetched,
    synced,
    pages,
    updated_from: updatedFrom,
    records,
    overview: getSellerCenterMirrorOverview(sellerId),
  };
}

function buildReturnSourceClaims(options = {}) {
  if (Array.isArray(options.claims) && options.claims.length > 0) {
    return options.claims;
  }

  return listMirrorEntities("claims", {
    sellerId: options.sellerId,
    limit: null,
  });
}

export async function syncReturns(options = {}) {
  const { connection, orderIndex, sellerId } = await withAuthorizedConnection(options);
  const sourceClaims = buildReturnSourceClaims({
    claims: options.claims,
    sellerId,
  });
  const records = [];
  let fetched = 0;

  for (const claimRecord of sourceClaims) {
    const claimId = normalizeNullable(claimRecord?.external_id);
    if (!claimId) {
      continue;
    }

    const payload = await fetchMercadoLivreJson(
      connection.access_token,
      `/post-purchase/v2/claims/${claimId}/returns`,
      { allowNotFound: true }
    );

    if (!payload) {
      continue;
    }

    const returnRecords = normalizeReturnRecords(payload, claimRecord, connection, orderIndex);
    fetched += returnRecords.length;
    records.push(...returnRecords);
  }

  const synced = upsertMirrorEntities("returns", records);

  return {
    ok: true,
    entity: "returns",
    status: "synced",
    incomplete: false,
    seller_id: sellerId,
    fetched,
    synced,
    pages: 1,
    records,
    overview: getSellerCenterMirrorOverview(sellerId),
  };
}

function extractPackIdsFromOrderIndex(orderIndex) {
  return [...orderIndex.ordersByPackId.keys()].filter(Boolean);
}

export async function syncPacks(options = {}) {
  const { connection, orderIndex, sellerId } = await withAuthorizedConnection(options);
  const packIds = Array.isArray(options.packIds) && options.packIds.length > 0
    ? [...new Set(options.packIds.map((value) => String(value).trim()).filter(Boolean))]
    : extractPackIdsFromOrderIndex(orderIndex);
  const records = [];

  for (const packId of packIds) {
    const payload = await fetchMercadoLivreJson(
      connection.access_token,
      `/packs/${packId}`,
      { allowNotFound: true }
    );

    if (!payload) {
      continue;
    }

    const record = normalizePackRecord(payload, connection, orderIndex, packId);
    if (record.external_id) {
      records.push(record);
    }
  }

  const synced = upsertMirrorEntities("packs", records);

  return {
    ok: true,
    entity: "packs",
    status: "synced",
    incomplete: false,
    seller_id: sellerId,
    fetched: records.length,
    synced,
    pages: 1,
    records,
    overview: getSellerCenterMirrorOverview(sellerId),
  };
}
