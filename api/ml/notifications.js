import { runMercadoLivreSync, getConnectionBySellerId } from "./sync.js";
import { syncClaims, syncReturns } from "./_lib/mirror-sync.js";
import { refreshNfeFromNotification } from "../nfe/_lib/mercado-livre-faturador.js";
import { invalidateDashboardCache, invalidateShipmentSlaCache } from "./dashboard.js";
import { invalidateOrdersCache } from "./orders.js";
import createLogger from "../_lib/logger.js";
import { timingSafeEqual } from "node:crypto";

const logger = createLogger("ml-notifications");

const NOTIFICATION_TOPICS = new Set(["orders_v2", "shipments", "post_purchase", "invoices"]);

// Secret compartilhado pra validar que o POST veio do ML e nao de um
// atacante externo. Configurado no painel do ML como header customizado
// ou query string na URL de notificacao.
const WEBHOOK_SECRET = (process.env.ML_WEBHOOK_SECRET || "").trim();

/**
 * Valida o secret do webhook via:
 *   1) Query string ?secret=xxx
 *   2) Header x-ml-webhook-secret
 *
 * Se ML_WEBHOOK_SECRET nao estiver configurado, loga warning mas aceita
 * (para nao quebrar producao durante rollout).
 */
function isWebhookAuthorized(request) {
  if (!WEBHOOK_SECRET) {
    logger.warn("ML_WEBHOOK_SECRET nao configurado — webhook aberto", { route: "ml-notifications" });
    return { ok: true };
  }
  const headerSecret = request.headers["x-ml-webhook-secret"];
  const querySecret = request.query?.secret;
  const provided = String(headerSecret || querySecret || "");
  const diag = {
    has_header: Boolean(headerSecret),
    header_len: headerSecret ? String(headerSecret).length : 0,
    has_query: Boolean(querySecret),
    query_len: querySecret ? String(querySecret).length : 0,
    expected_len: WEBHOOK_SECRET.length,
  };
  if (!provided) return { ok: false, reason: "missing", diag };
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  if (a.length !== b.length) return { ok: false, reason: "length_mismatch", diag };
  try {
    const match = timingSafeEqual(a, b);
    return { ok: match, reason: match ? null : "value_mismatch", diag };
  } catch {
    return { ok: false, reason: "compare_error", diag };
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

/**
 * Extrai o order_id ou shipment_id do resource do webhook.
 * Exemplos:
 *   /orders/123456789 → "123456789"
 *   /shipments/987654321 → "987654321"
 */
function resolveResourceId(payload) {
  const resource = normalizeNullable(payload?.resource);
  if (!resource) return null;
  const match = resource.match(/\/(orders|shipments)\/(\d+)/i);
  return match ? { type: match[1], id: match[2] } : null;
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    return response.status(200).json({ status: "ok" });
  }

  if (request.method !== "POST") {
    return response.status(405).json({ status: "error", error: "Method not allowed" });
  }

  // Webhook auth
  const auth = isWebhookAuthorized(request);
  if (!auth.ok) {
    logger.warn("webhook rejeitado", {
      route: "ml-notifications",
      ip: request.ip,
      reason: auth.reason,
      diag: auth.diag,
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

    // ══════════════════════════════════════════════════════════════════
    // INVALIDAÇÃO IMEDIATA DO CACHE
    //
    // Independente do que acontecer abaixo (sync rápido ou lento),
    // o cache do dashboard é invalidado IMEDIATAMENTE ao receber o
    // webhook. Isso garante que a próxima leitura do dashboard vai
    // recalcular os chips via OAuth (fetchMLLiveChipBucketsDetailed),
    // que é a ÚNICA fonte de verdade.
    //
    // O liveChipDetailedCache é limpo por invalidateDashboardCache().
    // ══════════════════════════════════════════════════════════════════
    invalidateDashboardCache(connection.id);
    invalidateOrdersCache();

    // Invalidação cirúrgica do cache SLA por shipment_id (Tarefa 8).
    // Quando o webhook traz um shipment_id explícito, invalida apenas esse
    // shipment no cache SLA (evita recalcular todos os shipments).
    // invalidateDashboardCache já limpa o shipmentSlaCache global como
    // fallback seguro, mas a invalidação cirúrgica é mais eficiente.
    const resourceInfo0 = resolveResourceId(payload);
    if (resourceInfo0?.type === "shipments" && resourceInfo0?.id) {
      invalidateShipmentSlaCache(resourceInfo0.id);
    }

    const updatedFrom =
      connection.last_sync_at ||
      new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // ══════════════════════════════════════════════════════════════════
    // TOPIC: post_purchase (reclamações/mediações)
    // ══════════════════════════════════════════════════════════════════
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
        seller_id: sellerId,
        claims_synced: claimsResult.synced,
        returns_synced: returnsResult.synced,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // TOPIC: invoices (notas fiscais)
    // ══════════════════════════════════════════════════════════════════
    if (topic === "invoices") {
      const invoiceResult = await refreshNfeFromNotification(payload, { sellerId });
      return response.status(200).json({
        status: invoiceResult.status,
        topic,
        seller_id: sellerId,
        reason: invoiceResult.reason,
        refreshed: invoiceResult.refreshed,
        order_ids: invoiceResult.order_ids,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // TOPIC: orders_v2 / shipments — SYNC INCREMENTAL RÁPIDO
    //
    // ESTRATÉGIA:
    //   1. Cache já foi invalidado acima (liveChipDetailedCache limpo)
    //   2. Próxima leitura do dashboard recalcula chips via OAuth API
    //   3. Sync incremental atualiza o banco local (para lista de pedidos)
    //   4. pageLimit=3 (150 pedidos max) — rápido e suficiente para webhook
    //
    // O ponto-chave: os CHIPS são recalculados via OAuth API a cada
    // request do dashboard (TTL 50s). O sync aqui apenas garante que
    // a LISTA de pedidos no banco local esteja atualizada para a UI.
    //
    // Antes: o cache não era invalidado no webhook, causando delay
    // de até 50s para refletir mudanças nos chips.
    // Agora: invalidação imediata + recálculo OAuth na próxima leitura.
    // ══════════════════════════════════════════════════════════════════
    const resourceInfo = resolveResourceId(payload);

    logger.info(`webhook: processando`, {
      topic,
      seller_id: sellerId,
      connection_id: connection.id,
      resource: resourceInfo ? `${resourceInfo.type}/${resourceInfo.id}` : "unknown",
    });

    const result = await runMercadoLivreSync({
      connectionId: connection.id,
      updatedFrom,
      pageLimit: 3,
    });

    return response.status(200).json({
      status: "ok",
      topic,
      seller_id: sellerId,
      synced: result.synced,
      total_fetched: result.totalFetched,
    });
  } catch (error) {
    // Retorna 500 pra ML fazer retry automaticamente.
    logger.error("webhook: erro interno", {
      error: error instanceof Error ? error.message : String(error),
    });
    return response.status(500).json({
      status: "error",
      error: "internal_error",
    });
  }
}
