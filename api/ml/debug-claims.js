/**
 * /api/ml/debug-claims — Endpoint temporário para investigar claims API.
 * Retorna detalhes das claims abertas para debug.
 * 
 * Query params:
 *   connection_id — ID da conexão (opcional, default = Ecoferro)
 *   limit — número de claims a retornar (default: 50)
 */
import { getLatestConnection, getConnectionById } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

export default async function handler(request, response) {
  const profile = requireAuthenticatedProfile(request);
  if (!profile) {
    return response.status(401).json({ error: "Sessao invalida." });
  }

  const connectionId = request.query?.connection_id || null;
  const limit = Math.min(Number(request.query?.limit) || 50, 200);

  const connection = connectionId
    ? getConnectionById(connectionId)
    : getLatestConnection();

  if (!connection?.id) {
    return response.status(400).json({ error: "Conexao nao encontrada." });
  }

  const validConnection = await ensureValidAccessToken(connection);
  if (!validConnection?.access_token) {
    return response.status(500).json({ error: "Token invalido." });
  }

  const token = validConnection.access_token;
  const sellerId = validConnection.seller_id;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // Busca claims abertas (mesma chamada que o classificador faz)
    const claimsUrl = `https://api.mercadolibre.com/post-purchase/v1/claims/search?player_role=respondent&player_user_id=${sellerId}&status=opened&limit=${limit}&offset=0`;
    const claimsR = await fetch(claimsUrl, { headers }).then(r => r.json());

    // Busca shipped com substatuses para debug in_transit
    const shippedUrl = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&shipping.status=shipped&sort=date_desc&limit=50&offset=0`;
    const shippedR = await fetch(shippedUrl, { headers }).then(r => r.json());

    // Busca detalhes de shipments para ver substatuses
    const shippedOrders = shippedR.results || [];
    const shippingIds = [...new Set(shippedOrders.map(o => o.shipping?.id).filter(Boolean))].slice(0, 30);
    
    const shipmentDetails = await Promise.all(
      shippingIds.map(id =>
        fetch(`https://api.mercadolibre.com/shipments/${id}`, { headers })
          .then(r => r.json())
          .then(d => ({ id, status: d.status, substatus: d.substatus, logistic_type: d.logistic_type }))
          .catch(() => ({ id, error: true }))
      )
    );

    // Busca pending para debug upcoming
    const pendingUrl = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&shipping.status=pending&sort=date_desc&limit=50&offset=0`;
    const pendingR = await fetch(pendingUrl, { headers }).then(r => r.json());

    return response.json({
      seller_id: sellerId,
      connection_id: validConnection.id,
      claims: {
        url: claimsUrl,
        total: claimsR.paging?.total || claimsR.total || 0,
        returned_count: (claimsR.data || claimsR.claims || claimsR.results || []).length,
        items: (claimsR.data || claimsR.claims || claimsR.results || []).map(c => ({
          id: c.id,
          resource_id: c.resource_id,
          status: c.status,
          stage: c.stage,
          type: c.type,
          role_status: c.players?.find(p => p.user_id === String(sellerId))?.status,
          date_created: c.date_created,
          last_updated: c.last_updated,
        })),
        raw_paging: claimsR.paging,
      },
      shipped: {
        total: shippedR.paging?.total || 0,
        shipment_substatuses: shipmentDetails,
        substatus_summary: shipmentDetails.reduce((acc, s) => {
          const key = `${s.status}/${s.substatus}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
      },
      pending: {
        total: pendingR.paging?.total || 0,
        sample_dates: (pendingR.results || []).slice(0, 10).map(o => ({
          id: o.id,
          date_created: o.date_created,
          shipping_status: o.shipping?.status,
        })),
      },
    });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
}
