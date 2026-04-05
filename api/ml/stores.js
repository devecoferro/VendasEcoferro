import { getLatestConnection } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";

export default async function handler(_request, response) {
  try {
    const baseConnection = getLatestConnection();

    if (!baseConnection?.seller_id || !baseConnection?.access_token) {
      return response.status(200).json({ stores: [] });
    }

    const connection = await ensureValidAccessToken(baseConnection);

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
