import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getItemImageUrl(
  accessToken: string,
  itemId: string | null | undefined,
  cache: Map<string, string | null>
) {
  if (!itemId) return null;
  if (cache.has(itemId)) return cache.get(itemId) ?? null;

  try {
    const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!itemRes.ok) {
      cache.set(itemId, null);
      return null;
    }

    const itemData = await itemRes.json();
    const pictures = Array.isArray(itemData.pictures) ? itemData.pictures : [];
    const firstPicture =
      pictures.find((picture: { secure_url?: string; url?: string }) => picture.secure_url || picture.url) ??
      null;

    const imageUrl =
      firstPicture?.secure_url ||
      firstPicture?.url ||
      itemData.secure_thumbnail ||
      itemData.thumbnail ||
      null;

    cache.set(itemId, imageUrl);
    return imageUrl;
  } catch {
    cache.set(itemId, null);
    return null;
  }
}

async function getShipmentSnapshot(
  accessToken: string,
  shippingId: string | null | undefined,
  cache: Map<string, Record<string, unknown> | null>
) {
  if (!shippingId) return null;
  if (cache.has(shippingId)) return cache.get(shippingId) ?? null;

  try {
    const shippingRes = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!shippingRes.ok) {
      cache.set(shippingId, null);
      return null;
    }

    const shippingData = await shippingRes.json();
    const snapshot = {
      id: shippingData?.id ?? null,
      status: shippingData?.status ?? null,
      substatus: shippingData?.substatus ?? null,
      logistic_type: shippingData?.logistic_type ?? null,
      mode: shippingData?.mode ?? null,
      receiver_name:
        shippingData?.receiver_address?.receiver_name ||
        shippingData?.receiver_name ||
        null,
      status_history: {
        date_handling: shippingData?.status_history?.date_handling ?? null,
        date_ready_to_ship: shippingData?.status_history?.date_ready_to_ship ?? null,
        date_shipped: shippingData?.status_history?.date_shipped ?? null,
        date_delivered: shippingData?.status_history?.date_delivered ?? null,
        date_cancelled: shippingData?.status_history?.date_cancelled ?? null,
        date_returned: shippingData?.status_history?.date_returned ?? null,
        date_not_delivered: shippingData?.status_history?.date_not_delivered ?? null,
      },
      shipping_option: {
        name: shippingData?.shipping_option?.name ?? null,
        estimated_delivery_limit:
          shippingData?.shipping_option?.estimated_delivery_limit?.date ?? null,
        estimated_delivery_final:
          shippingData?.shipping_option?.estimated_delivery_final?.date ?? null,
      },
    };

    cache.set(shippingId, snapshot);
    return snapshot;
  } catch {
    cache.set(shippingId, null);
    return null;
  }
}

async function ensureValidToken(supabase: any, connection: any, clientId: string, clientSecret: string) {
  const expiresAt = new Date(connection.token_expires_at);
  if (expiresAt > new Date(Date.now() + 60000)) {
    return connection.access_token;
  }

  // Refresh
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Token refresh failed: ${details}`);
  }

  const data = await res.json();
  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from("ml_connections")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: newExpiry,
    })
    .eq("id", connection.id);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("ML_CLIENT_ID")!;
  const clientSecret = Deno.env.get("ML_CLIENT_SECRET")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { connection_id, date_from, date_to, status_filter } = body;

    // Get connection
    const { data: conn, error: connErr } = await supabase
      .from("ml_connections")
      .select("*")
      .eq("id", connection_id)
      .single();

    if (connErr || !conn) {
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await ensureValidToken(supabase, conn, clientId, clientSecret);

    // Build orders search URL
    let url = `https://api.mercadolibre.com/orders/search?seller=${conn.seller_id}&sort=date_desc&limit=50`;
    if (date_from) url += `&order.date_created.from=${date_from}T00:00:00.000-00:00`;
    if (date_to) url += `&order.date_created.to=${date_to}T23:59:59.000-00:00`;
    if (status_filter) url += `&order.status=${status_filter}`;

    const ordersRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      console.error("ML orders fetch failed:", ordersRes.status, errText);
      return new Response(JSON.stringify({ error: "Failed to fetch orders", details: errText }), {
        status: ordersRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ordersData = await ordersRes.json();
    const orders = ordersData.results || [];
    const itemImageCache = new Map<string, string | null>();
    const shipmentSnapshotCache = new Map<string, Record<string, unknown> | null>();

    // Map and upsert orders
    let synced = 0;
    for (const order of orders) {
      const item = order.order_items?.[0];
      if (!item) continue;
      const itemId = item.item?.id || null;
      const shippingId = order.shipping?.id ? String(order.shipping.id) : null;
      const productImageUrl = await getItemImageUrl(accessToken, itemId, itemImageCache);
      const shipmentSnapshot = await getShipmentSnapshot(
        accessToken,
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
      const buyerName = shipmentReceiverName || buyerNameFromOrder || order.buyer?.nickname || null;

      const orderRecord = {
        connection_id: conn.id,
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
        },
      };

      const { error } = await supabase
        .from("ml_orders")
        .upsert(orderRecord, { onConflict: "order_id" });

      if (!error) synced++;
    }

    // Update last_sync_at
    await supabase
      .from("ml_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", conn.id);

    return new Response(
      JSON.stringify({
        success: true,
        total_fetched: orders.length,
        synced,
        paging: ordersData.paging,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ml-sync-orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
