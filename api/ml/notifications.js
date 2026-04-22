import { runMercadoLivreSync, getConnectionBySellerId } from "./sync.js";
import { syncClaims, syncReturns } from "./_lib/mirror-sync.js";
import { refreshNfeFromNotification } from "../nfe/_lib/mercado-livre-faturador.js";
import createLogger from "../_lib/logger.js";
import { timingSafeEqual } from "node:crypto";

const logger = createLogger("ml-notifications");

const NOTIFICATION_TOPICS = new Set(["orders_v2", "shipments", "post_purchase", "invoices"]);

// Secret compartilhado pra validar que o POST veio do ML e nao de um
// atacante externo. Configurado no painel do ML como header customizado
// ou query string na URL de notificacao. Auditoria de seg. (sprint 1.1).
const WEBHOOK_SECRET = (process.env.ML_WEBHOOK_SECRET || "").trim();

/**
 * Valida o secret do webhook via:
 *   1) Query string ?secret=xxx
 *   2) Header x-ml-webhook-secret
 *
 * Se ML_WEBHOOK_SECRET nao estiver configurado, loga warning mas aceita
 * (para nao quebrar producao durante rollout — admin configura env var
 * e atualiza URL no painel ML dentro de uma janela).
 */
function isWebhookAuthorized(request) {
  if (!WEBHOOK_SECRET) {
    logger.warn("ML_WEBHOOK_SECRET nao configurado — webhook aberto", { route: "ml-notifications" });
    return true;
  }
  const provided = String(
    request.headers["x-ml-webhook-secret"] ||
      request.query?.secret ||
      ""
  );
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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

  // Webhook auth — auditoria seg. sprint 1.1
  if (!isWebhookAuthorized(request)) {
    logger.warn("webhook rejeitado — secret invalido ou ausente", {
      route: "ml-notifications",
      ip: request.ip,
    });
    return response.status(401).json({ status: "error", error: "unauthorized" });
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
