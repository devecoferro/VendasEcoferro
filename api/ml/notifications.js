import { runMercadoLivreSync, getConnectionBySellerId } from "./sync.js";
import { syncClaims, syncReturns } from "./_lib/mirror-sync.js";
import { refreshNfeFromNotification } from "../nfe/_lib/mercado-livre-faturador.js";

const NOTIFICATION_TOPICS = new Set(["orders_v2", "shipments", "post_purchase", "invoices"]);

function getPayload(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveSellerId(payload) {
  const direct = normalizeNullable(payload?.user_id);
  if (direct) {
    return direct;
  }

  const resource = normalizeNullable(payload?.resource);
  const matched = resource?.match(/\/users\/(\d+)/i);
  return matched?.[1] || "";
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    return response.status(200).json({ status: "ok" });
  }

  if (request.method !== "POST") {
    return response.status(405).json({ status: "error", error: "Method not allowed" });
  }

  const payload = getPayload(request);

  try {
    const topic = String(payload.topic || "");
    const sellerId = resolveSellerId(payload);

    if (!NOTIFICATION_TOPICS.has(topic) || !sellerId) {
      return response.status(200).json({ status: "ignored" });
    }

    const connection = await getConnectionBySellerId(sellerId);
    if (!connection?.id) {
      return response.status(200).json({ status: "ignored" });
    }

    const updatedFrom =
      connection.last_sync_at ||
      new Date(Date.now() - 15 * 60 * 1000).toISOString();

    if (topic === "post_purchase") {
      const claimsResult = await syncClaims({
        connectionId: connection.id,
        updatedFrom,
        pageLimit: 3,
      });
      const returnsResult = await syncReturns({
        connectionId: connection.id,
        claims: claimsResult.records,
      });

      return response.status(200).json({
        status: "ok",
        topic,
        claims_synced: claimsResult.synced,
        returns_synced: returnsResult.synced,
      });
    }

    if (topic === "invoices") {
      const invoiceResult = await refreshNfeFromNotification(payload, { sellerId });
      return response.status(200).json({
        status: invoiceResult.status,
        topic,
        reason: invoiceResult.reason,
        refreshed: invoiceResult.refreshed,
        order_ids: invoiceResult.order_ids,
      });
    }

    const result = await runMercadoLivreSync({
      connectionId: connection.id,
      updatedFrom,
      pageLimit: 3,
    });

    return response.status(200).json({
      status: "ok",
      synced: result.synced,
      total_fetched: result.totalFetched,
      topic,
    });
  } catch (error) {
    // Retorna 500 pra ML fazer retry automaticamente.
    // Antes retornava 200 com status:error — ML interpretava como sucesso
    // e não re-enviava a notificação, causando perda silenciosa.
    return response.status(500).json({
      status: "error",
      error: "internal_error",
    });
  }
}
