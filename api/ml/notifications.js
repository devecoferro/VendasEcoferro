import { runMercadoLivreSync, getConnectionBySellerId } from "./sync.js";

const NOTIFICATION_TOPICS = new Set(["orders_v2", "shipments"]);

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
    const sellerId = payload.user_id ? String(payload.user_id) : "";

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
    return response.status(200).json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

