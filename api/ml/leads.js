import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getLatestConnection } from "./_lib/storage.js";

/**
 * /api/ml/leads — Busca leads da API do Mercado Livre.
 *
 * GET /api/ml/leads              → lista leads (últimos 50)
 * GET /api/ml/leads?limit=N      → lista N leads
 * GET /api/ml/leads?offset=N     → paginação
 */

async function fetchMLLeads(token, sellerId, { limit = 50, offset = 0 } = {}) {
  const url = `https://api.mercadolibre.com/users/${encodeURIComponent(sellerId)}/leads?limit=${limit}&offset=${offset}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      error: true,
      status: response.status,
      message: text,
      results: [],
    };
  }

  return response.json();
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const connection = getLatestConnection();
    if (!connection?.id) {
      return response.status(400).json({ error: "Conexao ML nao encontrada." });
    }

    const validConnection = await ensureValidAccessToken(connection);
    const token = validConnection.access_token;
    const sellerId = String(validConnection.seller_id);

    const limit = Math.min(Number(request.query?.limit) || 50, 200);
    const offset = Number(request.query?.offset) || 0;

    const data = await fetchMLLeads(token, sellerId, { limit, offset });

    return response.status(200).json({
      seller_id: sellerId,
      ...data,
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
