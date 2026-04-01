import {
  SUPABASE_URL,
  getSupabaseHeaders,
  hasServiceRoleKey,
} from "./_lib/server-config.js";

export default async function handler(_request, response) {
  try {
    const connectionResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ml_connections?select=seller_id,access_token&order=created_at.desc&limit=1`,
      {
        headers: getSupabaseHeaders({ service: hasServiceRoleKey() }),
      }
    );

    if (!connectionResponse.ok) {
      return response.status(200).json({ stores: [] });
    }

    const connections = await connectionResponse.json();
    const connection = connections[0];

    if (!connection?.seller_id || !connection?.access_token) {
      return response.status(200).json({ stores: [] });
    }

    const storesResponse = await fetch(
      `https://api.mercadolibre.com/users/${connection.seller_id}/stores/search?tags=stock_location`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      }
    );

    if (!storesResponse.ok) {
      return response.status(200).json({ stores: [] });
    }

    const storesPayload = await storesResponse.json();
    const stores = Array.isArray(storesPayload.results)
      ? storesPayload.results.map((store) => ({
          id: String(store.id),
          description: store.description || null,
          network_node_id: store.network_node_id || null,
          location: store.location || null,
          services: store.services || null,
        }))
      : [];

    return response.status(200).json({ stores });
  } catch (error) {
    return response.status(200).json({
      stores: [],
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
