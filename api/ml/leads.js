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

// ML API tem diferentes endpoints dependendo do tipo de lead.
// Testa múltiplos caminhos e retorna o que funcionar.
const ML_LEAD_ENDPOINTS = (sellerId) => [
  { name: "ads_leads", url: `https://api.mercadolibre.com/ads/leads/search?user_id=${sellerId}&limit=50` },
  { name: "fb_leads", url: `https://api.mercadolibre.com/users/${sellerId}/fb_leads` },
  { name: "classifieds", url: `https://api.mercadolibre.com/users/${sellerId}/classifieds/leads` },
  { name: "user_leads", url: `https://api.mercadolibre.com/users/${sellerId}/leads` },
  { name: "leads_search", url: `https://api.mercadolibre.com/leads/search?seller_id=${sellerId}` },
  { name: "questions", url: `https://api.mercadolibre.com/questions/search?seller_id=${sellerId}&status=unanswered&sort_fields=date_created&sort_types=DESC&limit=50` },
  { name: "messages", url: `https://api.mercadolibre.com/messages/search?seller_id=${sellerId}&limit=50` },
  { name: "order_buyer", url: null }, // testado dinamicamente com order_id
  { name: "myfeeds", url: `https://api.mercadolibre.com/myfeeds/v2/users/${sellerId}/leads` },
];

async function fetchMLLeads(token, sellerId, { limit = 50, offset = 0, discover = false } = {}) {
  const headers = { Authorization: `Bearer ${token}` };

  if (discover) {
    // Modo discovery: testa todos os endpoints e retorna qual funciona
    const results = [];
    for (const ep of ML_LEAD_ENDPOINTS(sellerId)) {
      try {
        const r = await fetch(ep.url, { headers });
        const text = await r.text();
        let data = null;
        try { data = JSON.parse(text); } catch { /* não é JSON */ }
        results.push({
          name: ep.name,
          url: ep.url,
          status: r.status,
          ok: r.ok,
          has_results: Boolean(data?.results?.length || data?.length),
          total: data?.paging?.total || data?.total || data?.results?.length || data?.length || 0,
          sample_keys: data?.results?.[0] ? Object.keys(data.results[0]) : (Array.isArray(data) && data[0] ? Object.keys(data[0]) : []),
          preview: text.substring(0, 200),
        });
      } catch (e) {
        results.push({ name: ep.name, error: e.message });
      }
    }
    return { discover: true, endpoints: results };
  }

  // Modo normal: tenta os endpoints até achar um que funcione
  for (const ep of ML_LEAD_ENDPOINTS(sellerId)) {
    try {
      const r = await fetch(ep.url, { headers });
      if (r.ok) {
        const data = await r.json();
        const items = data.results || (Array.isArray(data) ? data : []);
        if (items.length > 0) {
          return { source: ep.name, ...data, results: items };
        }
      }
    } catch { /* next */ }
  }

  return { error: true, message: "Nenhum endpoint de leads retornou dados.", results: [] };
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

    const discover = request.query?.discover === "true";
    const testOrder = request.query?.test_order;

    // Modo teste: buscar dados REAIS do comprador de um pedido
    if (testOrder) {
      const headers = { Authorization: `Bearer ${token}` };
      const results = {};

      // 1. GET /orders/{id} → buyer.phone, buyer.email
      try {
        const r = await fetch(`https://api.mercadolibre.com/orders/${testOrder}`, { headers });
        const d = await r.json();
        results.order_buyer = {
          status: r.status,
          buyer_id: d.buyer?.id,
          buyer_nickname: d.buyer?.nickname,
          buyer_first_name: d.buyer?.first_name,
          buyer_last_name: d.buyer?.last_name,
          buyer_email: d.buyer?.email,
          buyer_phone: d.buyer?.phone,
        };
      } catch (e) { results.order_buyer = { error: e.message }; }

      // 2. Pegar shipping_id do pedido
      try {
        const r = await fetch(`https://api.mercadolibre.com/orders/${testOrder}`, { headers });
        const d = await r.json();
        const shipId = d.shipping?.id;
        if (shipId) {
          // 3. GET /shipments/{id} → receiver_address com telefone
          const sr = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, { headers });
          const sd = await sr.json();
          results.shipment_receiver = {
            status: sr.status,
            receiver_name: sd.receiver_address?.receiver_name,
            receiver_phone: sd.receiver_address?.receiver_phone,
            receiver_city: sd.receiver_address?.city?.name,
            receiver_state: sd.receiver_address?.state?.name,
            receiver_zip: sd.receiver_address?.zip_code,
          };
        }
      } catch (e) { results.shipment_receiver = { error: e.message }; }

      return response.status(200).json({ seller_id: sellerId, test_order: testOrder, ...results });
    }

    const data = await fetchMLLeads(token, sellerId, { limit, offset, discover });

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
