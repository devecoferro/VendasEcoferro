import {
  SUPABASE_URL,
  getSupabaseHeaders,
  hasServiceRoleKey,
} from "./_lib/server-config.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const limitParam = Number(request.query.limit || 500);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 1000))
      : 500;

    const ordersResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ml_orders?select=id,order_id,sale_number,sale_date,buyer_name,buyer_nickname,item_title,item_id,product_image_url,sku,quantity,amount,order_status,raw_data&order=sale_date.desc&limit=${limit}`,
      {
        headers: getSupabaseHeaders({ service: hasServiceRoleKey() }),
      }
    );

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text();
      return response.status(ordersResponse.status).json({
        error: "Failed to fetch orders",
        details: errorText,
      });
    }

    const orders = await ordersResponse.json();
    return response.status(200).json({ orders: Array.isArray(orders) ? orders : [] });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

