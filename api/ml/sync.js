const SUPABASE_URL = "https://gyaddryvtuzllcggorjc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_USdCDZTlvuXFTOBlAvYSpQ_ne5ka8Ee";
const ML_PAGE_LIMIT = 50;
const MAX_PAGES = 20;

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    ...extra,
  };
}

async function getConnection(connectionId) {
  const connectionResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/ml_connections?select=id,seller_id,seller_nickname,access_token,last_sync_at,token_expires_at&` +
      `id=eq.${encodeURIComponent(connectionId)}&limit=1`,
    {
      headers: getSupabaseHeaders(),
    }
  );

  if (!connectionResponse.ok) {
    throw new Error("Nao foi possivel carregar a conexao do Mercado Livre.");
  }

  const connections = await connectionResponse.json();
  return connections[0] ?? null;
}

async function primeSupabaseSync(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/ml-sync-orders`, {
      method: "POST",
      headers: getSupabaseHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });
  } catch {
    // The paginated sync below is still able to continue if the current token remains valid.
  }
}

function isTokenExpiringSoon(tokenExpiresAt) {
  if (!tokenExpiresAt) return true;
  const expiresAt = new Date(tokenExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() <= Date.now() + 60 * 1000;
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
  if (cache.has(itemId)) return cache.get(itemId) ?? null;

  try {
    const itemResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!itemResponse.ok) {
      cache.set(itemId, null);
      return null;
    }

    const itemPayload = await itemResponse.json();
    const pictures = Array.isArray(itemPayload.pictures) ? itemPayload.pictures : [];
    const firstPicture =
      pictures.find((picture) => picture?.secure_url || picture?.url) ?? null;

    const imageUrl =
      firstPicture?.secure_url ||
      firstPicture?.url ||
      itemPayload.secure_thumbnail ||
      itemPayload.thumbnail ||
      null;

    cache.set(itemId, imageUrl);
    return imageUrl;
  } catch {
    cache.set(itemId, null);
    return null;
  }
}

async function getShipmentSnapshot(accessToken, shippingId, cache) {
  if (!shippingId) return null;
  if (cache.has(shippingId)) return cache.get(shippingId) ?? null;

  try {
    const shipmentResponse = await fetch(
      `https://api.mercadolibre.com/shipments/${shippingId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!shipmentResponse.ok) {
      cache.set(shippingId, null);
      return null;
    }

    const shipmentPayload = await shipmentResponse.json();
    const snapshot = {
      id: shipmentPayload?.id ?? null,
      status: shipmentPayload?.status ?? null,
      substatus: shipmentPayload?.substatus ?? null,
      logistic_type: shipmentPayload?.logistic_type ?? null,
      mode: shipmentPayload?.mode ?? null,
      receiver_name:
        shipmentPayload?.receiver_address?.receiver_name ||
        shipmentPayload?.receiver_name ||
        null,
      status_history: {
        date_handling: shipmentPayload?.status_history?.date_handling ?? null,
        date_ready_to_ship: shipmentPayload?.status_history?.date_ready_to_ship ?? null,
        date_shipped: shipmentPayload?.status_history?.date_shipped ?? null,
        date_delivered: shipmentPayload?.status_history?.date_delivered ?? null,
        date_cancelled: shipmentPayload?.status_history?.date_cancelled ?? null,
        date_returned: shipmentPayload?.status_history?.date_returned ?? null,
        date_not_delivered: shipmentPayload?.status_history?.date_not_delivered ?? null,
      },
      shipping_option: {
        name: shipmentPayload?.shipping_option?.name ?? null,
        estimated_delivery_limit:
          shipmentPayload?.shipping_option?.estimated_delivery_limit?.date ?? null,
        estimated_delivery_final:
          shipmentPayload?.shipping_option?.estimated_delivery_final?.date ?? null,
      },
    };

    cache.set(shippingId, snapshot);
    return snapshot;
  } catch {
    cache.set(shippingId, null);
    return null;
  }
}

function buildDepositSnapshot(order, shipmentSnapshot, storesById, storesByNodeId) {
  const stock = order?.order_items?.[0]?.stock;
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
  updatedFrom,
  offset,
}) {
  const params = new URLSearchParams({
    seller: sellerId,
    sort: "date_desc",
    limit: String(ML_PAGE_LIMIT),
    offset: String(offset),
  });

  if (dateFrom) {
    params.set("order.date_created.from", `${dateFrom}T00:00:00.000-00:00`);
  }

  if (dateTo) {
    params.set("order.date_created.to", `${dateTo}T23:59:59.000-00:00`);
  }

  if (statusFilter) {
    params.set("order.status", statusFilter);
  }

  if (updatedFrom) {
    params.set("order.date_last_updated.from", updatedFrom);
  }

  return `https://api.mercadolibre.com/orders/search?${params.toString()}`;
}

async function upsertOrders(orderRecords) {
  if (orderRecords.length === 0) {
    return;
  }

  const upsertResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/ml_orders?on_conflict=order_id`,
    {
      method: "POST",
      headers: getSupabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(orderRecords),
    }
  );

  if (!upsertResponse.ok) {
    const errorText = await upsertResponse.text();
    throw new Error(`Falha ao gravar pedidos sincronizados: ${errorText}`);
  }
}

async function updateLastSync(connectionId) {
  await fetch(`${SUPABASE_URL}/rest/v1/ml_connections?id=eq.${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: getSupabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({
      last_sync_at: new Date().toISOString(),
    }),
  });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      connection_id,
      date_from,
      date_to,
      status_filter,
      updated_from,
    } = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};

    if (!connection_id) {
      return response.status(400).json({ success: false, error: "connection_id is required" });
    }

    const initialConnection = await getConnection(connection_id);

    if (!initialConnection?.seller_id) {
      return response.status(404).json({ success: false, error: "Connection not found" });
    }

    if (isTokenExpiringSoon(initialConnection.token_expires_at)) {
      await primeSupabaseSync({
        connection_id,
        date_from,
        date_to,
        status_filter,
        updated_from,
      });
    }

    const connection = (await getConnection(connection_id)) || initialConnection;

    if (!connection?.access_token || !connection?.seller_id) {
      return response.status(400).json({
        success: false,
        error: "Conexao do Mercado Livre sem token valido.",
      });
    }

    const sellerStores = await getSellerStores(connection.access_token, String(connection.seller_id));
    const storesById = new Map();
    const storesByNodeId = new Map();

    for (const store of sellerStores) {
      if (store?.id) storesById.set(String(store.id), store);
      if (store?.network_node_id) storesByNodeId.set(String(store.network_node_id), store);
    }

    const itemImageCache = new Map();
    const shipmentSnapshotCache = new Map();

    let offset = 0;
    let pageCount = 0;
    let totalFetched = 0;
    let totalSynced = 0;
    let paging = null;

    while (pageCount < MAX_PAGES) {
      const ordersUrl = buildOrdersSearchUrl({
        sellerId: String(connection.seller_id),
        dateFrom: date_from,
        dateTo: date_to,
        statusFilter: status_filter,
        updatedFrom: updated_from,
        offset,
      });

      const ordersResponse = await fetch(ordersUrl, {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      });

      if (!ordersResponse.ok) {
        const errorText = await ordersResponse.text();
        return response.status(ordersResponse.status).json({
          success: false,
          error: "Falha ao buscar pedidos no Mercado Livre.",
          details: errorText,
        });
      }

      const ordersPayload = await ordersResponse.json();
      const pageOrders = Array.isArray(ordersPayload.results) ? ordersPayload.results : [];
      paging = ordersPayload.paging || paging;

      if (pageOrders.length === 0) {
        break;
      }

      const pageRecords = [];

      for (const order of pageOrders) {
        const item = order.order_items?.[0];
        if (!item) continue;

        const itemId = item.item?.id || null;
        const shippingId = order.shipping?.id ? String(order.shipping.id) : null;
        const productImageUrl = await getItemImageUrl(connection.access_token, itemId, itemImageCache);
        const shipmentSnapshot = await getShipmentSnapshot(
          connection.access_token,
          shippingId,
          shipmentSnapshotCache
        );
        const shipmentReceiverName =
          typeof shipmentSnapshot?.receiver_name === "string"
            ? shipmentSnapshot.receiver_name
            : null;
        const buyerNameFromOrder = order.buyer?.first_name
          ? `${order.buyer.first_name} ${order.buyer.last_name || ""}`.trim()
          : null;
        const buyerName =
          shipmentReceiverName || buyerNameFromOrder || order.buyer?.nickname || null;
        const depositSnapshot = buildDepositSnapshot(
          order,
          shipmentSnapshot,
          storesById,
          storesByNodeId
        );

        pageRecords.push({
          connection_id: connection.id,
          order_id: String(order.id),
          sale_number: String(order.id),
          sale_date: order.date_created,
          buyer_name: buyerName,
          buyer_nickname: order.buyer?.nickname || null,
          item_title: item.item?.title || null,
          item_id: itemId,
          product_image_url: productImageUrl,
          sku: item.item?.seller_sku || null,
          quantity: item.quantity || 1,
          amount: item.unit_price ? item.unit_price * (item.quantity || 1) : null,
          order_status: order.status || null,
          shipping_id: shippingId,
          raw_data: {
            ...order,
            shipment_snapshot: shipmentSnapshot,
            deposit_snapshot: depositSnapshot,
          },
        });
      }

      await upsertOrders(pageRecords);

      totalFetched += pageOrders.length;
      totalSynced += pageRecords.length;
      pageCount += 1;
      offset += pageOrders.length;

      const totalAvailable = Number(ordersPayload?.paging?.total ?? 0);
      if (pageOrders.length < ML_PAGE_LIMIT || (totalAvailable > 0 && offset >= totalAvailable)) {
        break;
      }
    }

    await updateLastSync(connection.id);

    return response.status(200).json({
      success: true,
      total_fetched: totalFetched,
      synced: totalSynced,
      pages: pageCount,
      paging,
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
