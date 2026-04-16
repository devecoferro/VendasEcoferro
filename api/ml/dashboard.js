import { db } from "../_lib/db.js";
import { getLatestConnection, getOrderSummariesByScope, listConnections } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  getMirrorEntityStatusBreakdown,
  getSellerCenterMirrorOverview,
} from "./_lib/mirror-storage.js";
import { listNfeDocumentsBySellerId } from "../nfe/_lib/nfe-storage.js";
import { getEmittedInvoiceLookup } from "./_lib/document-storage.js";
import {
  getLatestPrivateSellerCenterSnapshotsByStoreAndTab,
  getPrivateSellerCenterSnapshotStatus,
} from "./_lib/private-seller-center-storage.js";
import { buildPrivateSellerCenterPostSaleAudit } from "./_lib/private-seller-center-audit.js";

const OPEN_STATUSES = new Set(["pending", "handling", "ready_to_ship", "confirmed", "paid"]);
const TRANSIT_STATUSES = new Set(["shipped", "in_transit"]);
const FINAL_EXCEPTION_STATUSES = new Set(["cancelled", "not_delivered", "returned"]);
const OPERATIONAL_BUCKETS = ["today", "upcoming", "in_transit", "finalized", "cancelled"];
// Piso de visibilidade: o app só opera com vendas de 01/04/2026 em diante.
// Alinhado com MIN_SYNC_DATE_FROM (api/ml/sync.js) e MIN_VISIBLE_SALE_DATE
// (api/ml/_lib/storage.js). Usado no chip "Canceladas" pra contar apenas
// canceladas criadas a partir desse piso na ML API.
const MIN_CANCELLED_DATE_FROM = "2026-04-01";
const NATIVE_TODAY_SUBSTATUSES = new Set([
  "ready_for_pickup",
  "in_warehouse",
  "ready_to_pack",
  "packed",
]);
const NATIVE_UPCOMING_READY_TO_SHIP_SUBSTATUSES = new Set([
  "invoice_pending",
  "in_packing_list",
  "in_hub",
]);
const NATIVE_IN_TRANSIT_SUBSTATUSES = new Set(["waiting_for_withdrawal"]);
const NATIVE_FINALIZED_NOT_DELIVERED_SUBSTATUSES = new Set(["lost"]);
const CROSS_DOCKING_NATIVE_UPCOMING_READY_TO_SHIP_SUBSTATUSES = new Set([
  "invoice_pending",
  "in_packing_list",
]);
const CROSS_DOCKING_NATIVE_IN_TRANSIT_SHIPPED_SUBSTATUSES = new Set([
  "out_for_delivery",
  "receiver_absent",
  "not_visited",
]);
// Substatuses for "shipped" that mean truly in transit (not just waiting for carrier).
// "waiting_for_withdrawal" removido — significa que o pacote está num ponto de retirada
// aguardando o comprador. Do ponto de vista do vendedor, o envio foi concluído.
// No ML Seller Center, esses pedidos NÃO aparecem em "Em trânsito".
const SHIPPED_IN_TRANSIT_SUBSTATUSES = new Set([
  "out_for_delivery",
  "receiver_absent",
  "not_visited",
  "at_customs",
]);
// Substatuses de "not_delivered" que indicam logística ainda ativa (pacote em movimento).
// No ML Seller Center, esses pedidos aparecem em "Em trânsito", não "Finalizadas".
const NOT_DELIVERED_IN_TRANSIT_SUBSTATUSES = new Set([
  "returning_to_sender",
  "returning_to_hub",
  "delayed",
  "return_failed",
]);
const CROSS_DOCKING_TRANSIT_SUBSTATUSES = new Set([
  "picked_up",
  "authorized_by_carrier",
  // "in_hub" removido — no ML Seller Center, pedidos "in_hub" estão em
  // "Próximos dias", não "Em trânsito". O pacote está no hub esperando
  // ser processado pelo transportador, não está efetivamente em trânsito.
]);
const CROSS_DOCKING_UPCOMING_SUBSTATUSES = new Set(["in_packing_list", "in_hub"]);
const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";
const DASHBOARD_CACHE_TTL_MS = 30 * 1000; // 30s — fetchMLLiveChipBucketsDetailed faz ~10 API calls
const SELLER_CENTER_MIRROR_SOURCE =
  "internal_operational_baseline+public_entities_tracked_separately";
const SELLER_CENTER_FINALIZED_STATUS_KEYWORDS = [
  "accepted",
  "approved",
  "cancel",
  "closed",
  "complete",
  "completed",
  "done",
  "expired",
  "finish",
  "final",
  "refunded",
  "reject",
  "resolved",
  "returned",
  "success",
];
const UNDER_REVIEW_KEYWORDS = [
  "review",
  "pending_review",
  "pending_cancel",
  "hold",
  "blocked",
  "rejected",
  "missing",
  "damage",
  "not_found",
];
const INTERNAL_OPERATIONAL_NOTE =
  "Resumo operacional interno calculado a partir de pedidos sincronizados e snapshots logísticos.";
const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
let dashboardCache = null;

export function invalidateDashboardCache() {
  dashboardCache = null;
  liveChipDetailedCache.clear();
}

function normalizeState(value, fallback = "none") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized || fallback;
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCalendarKey(date) {
  return calendarFormatter.format(date);
}

function getDateKey(value) {
  const parsed = parseDate(value);
  return parsed ? getCalendarKey(parsed) : null;
}

function getSlaDateKey(value) {
  if (typeof value === "string") {
    const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (matched) {
      return matched[1];
    }
  }

  return getDateKey(value);
}

function isSameCalendarDay(leftKey, rightKey) {
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isSameOrPastCalendarDay(leftKey, rightKey) {
  return Boolean(leftKey && rightKey && leftKey <= rightKey);
}

function getRawData(order) {
  return order?.raw_data && typeof order.raw_data === "object" ? order.raw_data : {};
}

function getShipmentSnapshot(order) {
  return getRawData(order).shipment_snapshot || {};
}

function getDepositSnapshot(order) {
  return getRawData(order).deposit_snapshot || {};
}

function getSlaSnapshot(order) {
  return getRawData(order).sla_snapshot || {};
}

function getLogisticType(order) {
  const shipmentSnapshot = getShipmentSnapshot(order);
  const depositSnapshot = getDepositSnapshot(order);

  return normalizeState(
    shipmentSnapshot.logistic_type || depositSnapshot.logistic_type || "",
    ""
  );
}

function getPayments(order) {
  return Array.isArray(getRawData(order).payments) ? getRawData(order).payments : [];
}

function getShipmentStatus(order) {
  const snapshot = getShipmentSnapshot(order);
  return {
    status: normalizeState(snapshot.status || order.order_status || "", ""),
    substatus: normalizeState(snapshot.substatus),
  };
}

function getOperationalDates(order) {
  const snapshot = getShipmentSnapshot(order);
  const statusHistory = snapshot.status_history || {};
  const shippingOption = snapshot.shipping_option || {};
  const slaSnapshot = getSlaSnapshot(order);

  return {
    handlingDateKey: getDateKey(statusHistory.date_handling),
    readyToShipDateKey: getDateKey(statusHistory.date_ready_to_ship),
    shippedDateKey: getDateKey(statusHistory.date_shipped),
    finalExceptionDateKey:
      getDateKey(statusHistory.date_cancelled) ||
      getDateKey(statusHistory.date_not_delivered) ||
      getDateKey(statusHistory.date_returned),
    operationalDueDateKey:
      getSlaDateKey(slaSnapshot.expected_date) ||
      getSlaDateKey(shippingOption.estimated_delivery_limit) ||
      getSlaDateKey(shippingOption.estimated_delivery_final),
    saleDateKey: getDateKey(order.sale_date),
  };
}

function getDepositInfo(order) {
  const depositSnapshot = getDepositSnapshot(order);
  const snapshot = getShipmentSnapshot(order);
  const logisticType = String(
    depositSnapshot.logistic_type || snapshot.logistic_type || "unknown"
  ).toLowerCase();
  const depositKey = String(depositSnapshot.key || "without-deposit");

  // Fulfillment: TODOS os warehouses do ML devem ser agrupados em "Full".
  // Isso inclui:
  //   1. logistic_type === "fulfillment" (explicito)
  //   2. deposit key "node:*" — warehouses ML (BRDF01, BRSP04, etc.)
  //      que podem ter logistic_type "unknown" ou até "cross_docking"
  //   3. deposit key "logistic:fulfillment"
  // No ML Seller Center, TUDO que não é o depósito do vendedor aparece como "Full".
  const isFulfillment =
    logisticType === "fulfillment" ||
    depositKey.startsWith("node:") ||
    depositKey === "logistic:fulfillment";

  if (isFulfillment) {
    return {
      key: "fulfillment",
      label: "Full",
      logisticType: "fulfillment",
    };
  }

  const label =
    typeof depositSnapshot.label === "string" && depositSnapshot.label.trim()
      ? depositSnapshot.label.trim()
      : "Vendas sem deposito";

  return {
    key: depositKey,
    label,
    logisticType,
  };
}

function getLaneForDeposit(depositInfo) {
  if (depositInfo.key === "without-deposit") {
    return "SEM DEPOSITO";
  }

  return depositInfo.logisticType === "fulfillment" ? "EM ANDAMENTO" : "PROGRAMADA";
}

function getHeadlineForDeposit(depositInfo) {
  if (depositInfo.key === "without-deposit") {
    return "Operacao sem deposito";
  }

  if (depositInfo.logisticType === "fulfillment") {
    return "Full";
  }

  return `Coleta | ${depositInfo.label}`;
}

// Status ativos para o dashboard (exclui delivered/cancelled que são 95%+ do DB).
const DASHBOARD_ACTIVE_STATUSES = [
  "pending", "handling", "ready_to_ship", "confirmed", "paid",
  "shipped", "in_transit", "not_delivered", "returned", "cancelled",
];

function fetchStoredOrders(limit = null) {
  // Query otimizada: filtra no SQL para carregar apenas pedidos relevantes.
  // Antes: carregava 10k+ rows (incluindo 9k delivered). Agora: ~400 rows.
  const placeholders = DASHBOARD_ACTIVE_STATUSES.map(() => "?").join(", ");
  const rows = db.prepare(`
    WITH filtered AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY COALESCE(sale_date, '') DESC, id ASC) AS rn,
        COUNT(*) OVER (PARTITION BY order_id) AS grouped_items_count,
        SUM(COALESCE(quantity, 0)) OVER (PARTITION BY order_id) AS grouped_quantity_total,
        SUM(COALESCE(amount, 0)) OVER (PARTITION BY order_id) AS grouped_amount_total
      FROM ml_orders
      WHERE lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) IN (${placeholders})
        AND lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) != 'delivered'
    )
    SELECT * FROM filtered WHERE rn = 1
    ORDER BY COALESCE(sale_date, '') DESC, order_id DESC
    ${limit != null ? `LIMIT ${Math.max(0, Number(limit) || 0)}` : ""}
  `).all(...DASHBOARD_ACTIVE_STATUSES);

  const mappedOrders = rows.map((row) => {
    let rawData = {};
    try {
      rawData = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data || {};
    } catch { rawData = {}; }
    return {
      ...row,
      raw_data: rawData,
      quantity: row.grouped_quantity_total || row.quantity || 0,
      amount: row.grouped_amount_total || row.amount || 0,
    };
  });

  // Enriquece pedidos com flag __nfe_emitted=true quando ja existe registro
  // em ml_invoice_documents (NFe efetivamente emitida no nosso sistema).
  // Isso evita classificar como "para gerar NFe" pedidos cujo ML ainda nao
  // refletiu o substatus mas que ja foram faturados.
  enrichOrdersWithEmittedInvoiceFlag(mappedOrders);

  return mappedOrders;
}

function enrichOrdersWithEmittedInvoiceFlag(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;

  // Agrupa por seller_id para minimizar queries.
  const sellerLookups = new Map();

  for (const order of orders) {
    const rawData = order.raw_data || {};
    const sellerId =
      rawData.seller_id ||
      rawData.seller?.id ||
      order.seller_id ||
      rawData.shipment_snapshot?.seller_id;
    if (!sellerId) continue;

    const sellerKey = String(sellerId);
    if (!sellerLookups.has(sellerKey)) {
      sellerLookups.set(sellerKey, getEmittedInvoiceLookup(sellerKey));
    }
    const lookup = sellerLookups.get(sellerKey);

    const orderId = order.order_id ? String(order.order_id) : null;
    const shipmentId =
      rawData.shipment_snapshot?.id ||
      rawData.shipping_id ||
      order.shipping_id;
    const packId = rawData.pack_id;

    const hasNfe =
      (orderId && lookup.orderIds.has(orderId)) ||
      (shipmentId && lookup.shipmentIds.has(String(shipmentId))) ||
      (packId && lookup.packIds.has(String(packId)));

    if (hasNfe) {
      order.raw_data = { ...rawData, __nfe_emitted: true };
    }
  }
}

function readDashboardCache() {
  if (!dashboardCache) {
    return null;
  }

  if (dashboardCache.expiresAt <= Date.now()) {
    dashboardCache = null;
    return null;
  }

  return dashboardCache.payload;
}

function writeDashboardCache(payload) {
  dashboardCache = {
    payload,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  };
}

function isOrderReadyForInvoiceLabel(order) {
  const rawData = getRawData(order);
  const shipmentStatus = normalizeState(getShipmentSnapshot(order).status || order.order_status);
  const orderStatus = normalizeState(rawData.status || order.order_status);
  const payments = getPayments(order);

  const hasApprovedPayment =
    payments.length === 0
      ? ["paid", "confirmed"].includes(orderStatus)
      : payments.some((payment) => normalizeState(payment.status) === "approved");

  return hasApprovedPayment && shipmentStatus === "ready_to_ship";
}

function hasEmittedInvoice(order) {
  const rawData = getRawData(order);
  return rawData?.__nfe_emitted === true;
}

function isOrderReadyToPrintLabel(order) {
  if (!isOrderReadyForInvoiceLabel(order)) return false;
  const substatus = normalizeState(getShipmentSnapshot(order).substatus);
  // NFe ja emitida no nosso sistema -> nao esta mais em "para gerar NFe".
  if (substatus === "invoice_pending") {
    return hasEmittedInvoice(order);
  }
  return true;
}

function isOrderInvoicePending(order) {
  if (!isOrderReadyForInvoiceLabel(order)) return false;
  if (hasEmittedInvoice(order)) return false;
  return normalizeState(getShipmentSnapshot(order).substatus) === "invoice_pending";
}

function isOrderUnderReview(order) {
  const rawData = getRawData(order);
  const shipmentSnapshot = getShipmentSnapshot(order);
  const orderStatus = normalizeState(rawData.status || order.order_status);
  const shipmentStatus = normalizeState(shipmentSnapshot.status);
  const shipmentSubstatus = normalizeState(shipmentSnapshot.substatus);
  const candidateStates = [
    orderStatus,
    shipmentStatus,
    shipmentSubstatus,
    normalizeState(rawData.status_detail || ""),
    normalizeState(rawData.cancel_detail || ""),
    normalizeState(shipmentSnapshot.substatus_detail || ""),
  ];

  if (FINAL_EXCEPTION_STATUSES.has(shipmentStatus)) {
    return true;
  }

  return candidateStates.some((value) =>
    UNDER_REVIEW_KEYWORDS.some((keyword) => value.includes(keyword))
  );
}

function isOrderForCollection(order) {
  if (!isOrderReadyToPrintLabel(order)) {
    return false;
  }

  return NATIVE_TODAY_SUBSTATUSES.has(normalizeState(getShipmentSnapshot(order).substatus));
}

function isOrderOverdue(order, todayKey) {
  const { status } = getShipmentStatus(order);
  if (
    !OPEN_STATUSES.has(status) ||
    isOrderInvoicePending(order) ||
    isOrderReadyToPrintLabel(order)
  ) {
    return false;
  }

  const { operationalDueDateKey } = getOperationalDates(order);
  return isSameOrPastCalendarDay(operationalDueDateKey, todayKey);
}

function classifyCrossDockingOrder(order, todayKey) {
  const { status, substatus } = getShipmentStatus(order);
  const dates = getOperationalDates(order);

  // shipping.status=pending: pedido pago que ainda não recebeu label.
  // ML Seller Center mostra em "Próximos dias" (aguardando processamento).
  if (status === "pending") {
    return "upcoming";
  }

  // ready_to_ship e handling são os status operacionais principais.
  if (status === "ready_to_ship" || status === "handling") {
    // Pedido retirado pelo transportador — em trânsito
    if (CROSS_DOCKING_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }

    // in_packing_list: pedido está na lista de separação do dia.
    // ML Seller Center classifica como "Envios de hoje".
    if (substatus === "in_packing_list") {
      return "today";
    }

    // in_hub: pacote está no hub do transportador aguardando processamento.
    // ML Seller Center mantém em "Próximos dias".
    if (substatus === "in_hub") {
      return "upcoming";
    }

    // Pronto para coleta — envios de hoje (coletor vem buscar)
    if (substatus === "ready_for_pickup") {
      return "today";
    }

    // Empacotado: pronto para envio. Usa SLA para decidir hoje/próximos.
    if (substatus === "packed") {
      if (dates.operationalDueDateKey) {
        return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
          ? "today"
          : "upcoming";
      }
      return "today";
    }

    // invoice_pending: vendedor ainda precisa emitir NF-e.
    // ML mantém em "Próximos dias" independente do SLA — o pedido
    // só vai para "Envios de hoje" DEPOIS que a NF-e é emitida
    // e o substatus muda para ready_for_pickup ou packed.
    // Se a NFe ja foi emitida no nosso sistema (mas o ML ainda nao
    // refletiu o substatus), tratamos como "packed": usa SLA.
    if (substatus === "invoice_pending") {
      if (hasEmittedInvoice(order)) {
        if (dates.operationalDueDateKey) {
          return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
            ? "today"
            : "upcoming";
        }
        return "today";
      }
      return "upcoming";
    }

    // Outros substatuses raros: usar SLA para classificar.
    if (dates.operationalDueDateKey) {
      return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey) ? "today" : "upcoming";
    }

    return "upcoming";
  }

  // "shipped" com tracking ativo = em trânsito, MAS apenas se recente.
  // ML Seller Center "Em trânsito" mostra apenas envios recentes com
  // tracking ativo. Pedidos shipped há muitos dias com substatus
  // "out_for_delivery" são stale (provavelmente já entregues sem scan).
  if (status === "shipped") {
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      // Só conta como "Em trânsito" se shipped nos últimos 3 dias
      const shippedAge = dates.shippedDateKey
        ? (new Date(todayKey + "T12:00:00").getTime() - new Date(dates.shippedDateKey + "T12:00:00").getTime()) / 86400000
        : 999;
      return shippedAge <= 2 ? "in_transit" : null;
    }
    return null;
  }

  // "in_transit" como status direto = definitivamente em trânsito
  if (status === "in_transit") {
    return "in_transit";
  }

  // not_delivered: SEMPRE finalized. No ML Seller Center, pedidos com entrega
  // falha (devoluções, perdidos, etc.) aparecem em "Gerenciar Pós-venda"
  // e "Finalizadas", NUNCA em "Em trânsito". Trânsito é só envio ativo.
  if (status === "not_delivered") {
    return "finalized";
  }

  // Canceladas ganham aba propria ("Canceladas") no frontend — sem o filtro
  // de data que limita "Finalizadas" ao dia atual.
  if (status === "cancelled") {
    return "cancelled";
  }

  // Devolvidas ficam em Finalizadas (pos-venda concluido).
  if (status === "returned") {
    return "finalized";
  }

  // paid, pending, confirmed, delivered e outros → não operacional
  return null;
}

function classifyFulfillmentOrder(order, todayKey, fulfillmentOperation) {
  const { status, substatus } = getShipmentStatus(order);
  const dates = getOperationalDates(order);
  const operationDateKey =
    getDateKey(fulfillmentOperation?.dateCreated) ||
    dates.readyToShipDateKey ||
    dates.handlingDateKey ||
    dates.saleDateKey;

  // shipping.status=pending: pedido pago aguardando processamento no fulfillment.
  if (status === "pending") {
    return "upcoming";
  }

  // Fulfillment: ready_to_ship e handling são os status operacionais principais.
  if (status === "ready_to_ship" || status === "handling") {
    // "ready_to_pack" = ML está ativamente preparando o pedido → sempre "hoje"
    if (substatus === "ready_to_pack") {
      return "today";
    }

    // "packed" = ML já empacotou no centro de distribuição → vai sair hoje.
    // ML Seller Center mostra esses em "Envios de hoje" independente do SLA.
    if (substatus === "packed") {
      return "today";
    }

    // "in_warehouse" = pedido no armazém ML aguardando. Usa SLA.
    if (substatus === "in_warehouse") {
      if (dates.operationalDueDateKey) {
        return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
          ? "today"
          : "upcoming";
      }
      return "upcoming";
    }

    return "upcoming";
  }

  // Fulfillment: mesma lógica — só tracking recente = in_transit.
  if (status === "shipped") {
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      const shippedAge = dates.shippedDateKey
        ? (new Date(todayKey + "T12:00:00").getTime() - new Date(dates.shippedDateKey + "T12:00:00").getTime()) / 86400000
        : 999;
      return shippedAge <= 2 ? "in_transit" : null;
    }
    return null;
  }

  if (status === "in_transit") {
    return "in_transit";
  }

  // not_delivered: SEMPRE finalized (pós-venda, não trânsito)
  if (status === "not_delivered") {
    return "finalized";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "returned") {
    return "finalized";
  }

  // paid, pending, confirmed, delivered e outros → não operacional
  return null;
}

function classifyNativeMercadoLivreOrder(order) {
  const { status, substatus } = getShipmentStatus(order);
  const logisticType = getLogisticType(order);
  const depositKey = getDepositSnapshot(order).key || "";
  const isStoreDeposit = depositKey.startsWith("store:");

  if (logisticType === "cross_docking" && isStoreDeposit) {
    if (status === "ready_to_ship") {
      if (substatus === "picked_up") {
        return "in_transit";
      }

      if (NATIVE_TODAY_SUBSTATUSES.has(substatus)) {
        return "today";
      }

      if (CROSS_DOCKING_NATIVE_UPCOMING_READY_TO_SHIP_SUBSTATUSES.has(substatus)) {
        // invoice_pending: vendedor ainda precisa emitir NF-e.
        // ML mantém em "Próximos dias" independente do SLA — o pedido
        // só vai para "Envios de hoje" DEPOIS que a NF-e é emitida
        // e o substatus muda para ready_for_pickup ou packed.
        // Se a NFe ja foi emitida no nosso sistema (mas o ML ainda nao
        // refletiu o substatus), tratamos como "packed": usa SLA.
        if (substatus === "invoice_pending") {
          if (hasEmittedInvoice(order)) {
            // NFe emitida localmente — usa SLA como se fosse "packed"
            const dates = getOperationalDates(order);
            if (dates.operationalDueDateKey) {
              return isSameOrPastCalendarDay(dates.operationalDueDateKey, getCalendarKey(new Date()))
                ? "today"
                : "upcoming";
            }
            return "today";
          }
          return "upcoming";
        }
        return "upcoming";
      }

      return null;
    }

    if (status === "shipped") {
      if (substatus === "none") {
        return "upcoming";
      }

      if (CROSS_DOCKING_NATIVE_IN_TRANSIT_SHIPPED_SUBSTATUSES.has(substatus)) {
        return "in_transit";
      }

      return null;
    }

    if (status === "not_delivered" && substatus === "returned") {
      return "finalized";
    }

    return null;
  }

  if (status === "ready_to_ship") {
    if (substatus === "picked_up") {
      return "in_transit";
    }

    if (NATIVE_TODAY_SUBSTATUSES.has(substatus)) {
      return "today";
    }

    if (NATIVE_UPCOMING_READY_TO_SHIP_SUBSTATUSES.has(substatus)) {
      // invoice_pending: vendedor ainda precisa emitir NF-e.
      // ML mantém em "Próximos dias" independente do SLA — o pedido
      // só vai para "Envios de hoje" DEPOIS que a NF-e é emitida
      // e o substatus muda para ready_for_pickup ou packed.
      // Se a NFe ja foi emitida no nosso sistema (mas o ML ainda nao
      // refletiu o substatus), tratamos como "packed": usa SLA.
      if (substatus === "invoice_pending") {
        if (hasEmittedInvoice(order)) {
          // NFe emitida localmente — usa SLA como se fosse "packed"
          const dates = getOperationalDates(order);
          if (dates.operationalDueDateKey) {
            return isSameOrPastCalendarDay(dates.operationalDueDateKey, getCalendarKey(new Date()))
              ? "today"
              : "upcoming";
          }
          return "today";
        }
        return "upcoming";
      }
      return "upcoming";
    }
  }

  if (status === "shipped" && NATIVE_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
    return "in_transit";
  }

  if (status === "not_delivered" && NATIVE_FINALIZED_NOT_DELIVERED_SUBSTATUSES.has(substatus)) {
    return "finalized";
  }

  return null;
}

function buildCrossDockingSummaryRows(orders, todayKey) {
  let cancelled = 0;
  let overdue = 0;
  let invoicePending = 0;
  let ready = 0;

  for (const order of orders) {
    if (FINAL_EXCEPTION_STATUSES.has(getShipmentStatus(order).status)) {
      cancelled += 1;
      continue;
    }

    if (isOrderInvoicePending(order)) {
      invoicePending += 1;
      continue;
    }

    if (isOrderReadyToPrintLabel(order)) {
      ready += 1;
      continue;
    }

    if (isOrderOverdue(order, todayKey)) {
      overdue += 1;
    }
  }

  return [
    { key: "cancelled", label: "Canceladas. Nao enviar", count: cancelled },
    { key: "overdue", label: "Atrasadas. Enviar", count: overdue },
    { key: "invoice_pending", label: "NF-e para gerenciar", count: invoicePending },
    { key: "ready", label: "Prontas para enviar", count: ready },
  ];
}

function buildFulfillmentSummaryRows(orders, activeBucket) {
  const label =
    activeBucket === "in_transit"
      ? "Em transito"
      : activeBucket === "finalized"
        ? "Finalizadas"
        : activeBucket === "cancelled"
          ? "Canceladas"
          : "No centro de distribuicao";

  return [{ key: "fulfillment", label, count: orders.length }];
}

function buildEmptyDepositEntry(info) {
  return {
    key: info.key,
    label: info.label,
    logistic_type: info.logisticType,
    lane: getLaneForDeposit(info),
    headline: getHeadlineForDeposit(info),
    counts: buildEmptyBucketCounts(),
    native_counts: buildEmptyBucketCounts(),
    order_ids_by_bucket: buildEmptyBucketOrderIds(),
    native_order_ids_by_bucket: buildEmptyBucketOrderIds(),
    operational_source:
      info.logisticType === "fulfillment"
        ? "shipment_snapshot+fulfillment_operations"
        : "shipment_sla+shipment_snapshot",
    native_source: SELLER_CENTER_MIRROR_SOURCE,
    total_count: 0,
    native_total_count: 0,
    summary_rows: [],
    summary_rows_by_bucket: {
      today: [],
      upcoming: [],
      in_transit: [],
      finalized: [],
      cancelled: [],
    },
    _orders: [],
  };
}

function buildInternalOperationalLayerMetadata() {
  return {
    status: "ready",
    note: INTERNAL_OPERATIONAL_NOTE,
    source: "orders+shipments",
  };
}

function buildEmptyBucketCounts() {
  return {
    today: 0,
    upcoming: 0,
    in_transit: 0,
    finalized: 0,
    cancelled: 0,
  };
}

function cloneBucketCounts(source = {}) {
  return {
    today: Number(source.today || 0),
    upcoming: Number(source.upcoming || 0),
    in_transit: Number(source.in_transit || 0),
    finalized: Number(source.finalized || 0),
    cancelled: Number(source.cancelled || 0),
  };
}

function buildEmptyBucketOrderIds() {
  return {
    today: [],
    upcoming: [],
    in_transit: [],
    finalized: [],
    cancelled: [],
  };
}

function cloneBucketOrderIds(source = {}) {
  return {
    today: Array.isArray(source.today) ? [...source.today] : [],
    upcoming: Array.isArray(source.upcoming) ? [...source.upcoming] : [],
    in_transit: Array.isArray(source.in_transit) ? [...source.in_transit] : [],
    finalized: Array.isArray(source.finalized) ? [...source.finalized] : [],
    cancelled: Array.isArray(source.cancelled) ? [...source.cancelled] : [],
  };
}

function getOrderExternalReferences(order) {
  const rawData = getRawData(order);
  const shipmentSnapshot = getShipmentSnapshot(order);

  return {
    local_order_id: normalizeNullable(order?.id),
    external_order_id: normalizeNullable(order?.order_id),
    shipment_id:
      normalizeNullable(order?.shipping_id) ||
      normalizeNullable(rawData.shipping_id) ||
      normalizeNullable(shipmentSnapshot.id),
    pack_id: normalizeNullable(rawData.pack_id),
  };
}

function buildSellerCenterOrderIndex(orders) {
  const byExternalOrderId = new Map();
  const byShipmentId = new Map();
  const byPackId = new Map();

  for (const order of orders) {
    const refs = getOrderExternalReferences(order);
    const depositInfo = getDepositInfo(order);
    const reference = {
      order,
      local_order_id: refs.local_order_id,
      external_order_id: refs.external_order_id,
      shipment_id: refs.shipment_id,
      pack_id: refs.pack_id,
      deposit_info: depositInfo,
    };

    if (reference.external_order_id && !byExternalOrderId.has(reference.external_order_id)) {
      byExternalOrderId.set(reference.external_order_id, reference);
    }

    if (reference.shipment_id && !byShipmentId.has(reference.shipment_id)) {
      byShipmentId.set(reference.shipment_id, reference);
    }

    if (reference.pack_id) {
      if (!byPackId.has(reference.pack_id)) {
        byPackId.set(reference.pack_id, []);
      }

      byPackId.get(reference.pack_id).push(reference);
    }
  }

  return {
    byExternalOrderId,
    byShipmentId,
    byPackId,
  };
}

function buildMirrorCoverage(rows) {
  const coverage = {
    orderIds: new Set(),
    shipmentIds: new Set(),
    packIds: new Set(),
  };

  for (const row of rows || []) {
    const orderId = normalizeNullable(row?.order_id);
    const shipmentId = normalizeNullable(row?.shipment_id);
    const packId = normalizeNullable(row?.pack_id);

    if (orderId) coverage.orderIds.add(orderId);
    if (shipmentId) coverage.shipmentIds.add(shipmentId);
    if (packId) coverage.packIds.add(packId);
  }

  return coverage;
}

function doesMirrorEntityOverlap(entity, coverage) {
  const orderId = normalizeNullable(entity?.order_id);
  const shipmentId = normalizeNullable(entity?.shipment_id);
  const packId = normalizeNullable(entity?.pack_id);

  return Boolean(
    (orderId && coverage.orderIds.has(orderId)) ||
      (shipmentId && coverage.shipmentIds.has(shipmentId)) ||
      (packId && coverage.packIds.has(packId))
  );
}

function isOrderCoveredByMirrorEntity(order, coverage) {
  const refs = getOrderExternalReferences(order);

  return Boolean(
    (refs.external_order_id && coverage.orderIds.has(refs.external_order_id)) ||
      (refs.shipment_id && coverage.shipmentIds.has(refs.shipment_id)) ||
      (refs.pack_id && coverage.packIds.has(refs.pack_id))
  );
}

function resolveMirrorEntityOrderReferences(entity, orderIndex) {
  const refs = [];
  const seen = new Set();

  function append(reference) {
    if (!reference) return;

    const key =
      reference.local_order_id ||
      reference.external_order_id ||
      reference.shipment_id ||
      reference.pack_id;

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    refs.push(reference);
  }

  const orderId = normalizeNullable(entity?.order_id);
  const shipmentId = normalizeNullable(entity?.shipment_id);
  const packId = normalizeNullable(entity?.pack_id);

  if (orderId && orderIndex.byExternalOrderId.has(orderId)) {
    append(orderIndex.byExternalOrderId.get(orderId));
  }

  if (shipmentId && orderIndex.byShipmentId.has(shipmentId)) {
    append(orderIndex.byShipmentId.get(shipmentId));
  }

  if (packId && orderIndex.byPackId.has(packId)) {
    for (const reference of orderIndex.byPackId.get(packId)) {
      append(reference);
    }
  }

  return refs;
}

function buildFallbackWithoutDepositInfo() {
  return {
    key: "without-deposit",
    label: "Vendas sem deposito",
    logisticType: "unknown",
  };
}

function resolveMirrorEntityDepositInfos(entity, orderIndex) {
  const orderReferences = resolveMirrorEntityOrderReferences(entity, orderIndex);
  if (orderReferences.length === 0) {
    return [buildFallbackWithoutDepositInfo()];
  }

  const deposits = new Map();
  for (const reference of orderReferences) {
    const depositInfo = reference?.deposit_info;
    if (!depositInfo?.key || deposits.has(depositInfo.key)) {
      continue;
    }

    deposits.set(depositInfo.key, depositInfo);
  }

  return deposits.size > 0 ? Array.from(deposits.values()) : [buildFallbackWithoutDepositInfo()];
}

function isSellerCenterMirrorFinalStatus(rawStatus) {
  const normalizedStatus = normalizeState(rawStatus, "");
  if (!normalizedStatus) {
    return false;
  }

  return SELLER_CENTER_FINALIZED_STATUS_KEYWORDS.some((keyword) =>
    normalizedStatus.includes(keyword)
  );
}

function classifySellerCenterMirrorEntity(entityType, entity) {
  if (entityType === "packs") {
    return null;
  }

  const rawStatus = normalizeState(entity?.raw_status, "");
  const rawPayload = entity?.raw_payload && typeof entity.raw_payload === "object"
    ? JSON.stringify(entity.raw_payload).toLowerCase()
    : "";

  if (isSellerCenterMirrorFinalStatus(rawStatus)) {
    return "finalized";
  }

  const transitKeywords = [
    "in_transit",
    "in transit",
    "in_the_way",
    "a caminho",
    "back_to_seller",
    "shipped",
    "transport",
  ];

  if (
    transitKeywords.some(
      (keyword) => rawStatus.includes(keyword) || rawPayload.includes(keyword)
    )
  ) {
    return "in_transit";
  }

  return "upcoming";
}

function buildQueueEntry(label, orderIds = [], note = "") {
  return {
    label,
    count: orderIds.length,
    order_ids: [...new Set(orderIds.filter(Boolean).map(String))],
    note,
  };
}

function buildPostSaleOverview(sellerId) {
  const mirrorOverview = getSellerCenterMirrorOverview(sellerId);
  const claimsStatusBreakdown = getMirrorEntityStatusBreakdown("claims", {
    sellerId,
    limit: 8,
  });
  const returnsStatusBreakdown = getMirrorEntityStatusBreakdown("returns", {
    sellerId,
    limit: 8,
  });
  const packsStatusBreakdown = getMirrorEntityStatusBreakdown("packs", {
    sellerId,
    limit: 8,
  });
  const privateSnapshotStatus = getPrivateSellerCenterSnapshotStatus({ sellerId });
  const latestPrivateSnapshots = getLatestPrivateSellerCenterSnapshotsByStoreAndTab({
    sellerId,
  });
  const privateAudit = buildPrivateSellerCenterPostSaleAudit(
    latestPrivateSnapshots,
    privateSnapshotStatus
  );

  return {
    total_open:
      Number(mirrorOverview.entities?.claims?.count || 0) +
      Number(mirrorOverview.entities?.returns?.count || 0),
    entities: {
      claims: {
        ...mirrorOverview.entities.claims,
        status_breakdown: claimsStatusBreakdown,
      },
      returns: {
        ...mirrorOverview.entities.returns,
        status_breakdown: returnsStatusBreakdown,
      },
      packs: {
        ...mirrorOverview.entities.packs,
        status_breakdown: packsStatusBreakdown,
      },
    },
    private_audit: privateAudit,
  };
}

function buildOperationalQueues(orders, sellerId, postSaleOverview) {
  const readyToPrintOrderIds = [];
  const invoicePendingOrderIds = [];
  const underReviewOrderIds = [];
  const collectionOrderIds = [];

  for (const order of orders) {
    if (isOrderReadyToPrintLabel(order)) {
      readyToPrintOrderIds.push(order.order_id);
    }

    if (isOrderInvoicePending(order)) {
      invoicePendingOrderIds.push(order.order_id);
    }

    if (isOrderUnderReview(order)) {
      underReviewOrderIds.push(order.order_id);
    }

    if (isOrderForCollection(order)) {
      collectionOrderIds.push(order.order_id);
    }
  }

  const nfeDocuments = listNfeDocumentsBySellerId(sellerId, null);
  const nfeSyncPendingOrderIds = nfeDocuments
    .filter(
      (document) =>
        document.status === "authorized" &&
        document.ml_sync_status !== "synced_with_mercadolivre"
    )
    .map((document) => document.order_id);
  const nfeAttentionOrderIds = nfeDocuments
    .filter((document) =>
      ["blocked", "error", "pending_configuration", "pending_data", "rejected"].includes(
        String(document.status || "").toLowerCase()
      )
    )
    .map((document) => document.order_id);

  return {
    ready_to_print: buildQueueEntry(
      "Prontas para imprimir",
      readyToPrintOrderIds,
      "Pedidos com etiqueta operacional liberada para expedicao."
    ),
    invoice_pending: buildQueueEntry(
      "NF-e pendente",
      invoicePendingOrderIds,
      "Pedidos em invoice_pending, candidatos ao fluxo fiscal."
    ),
    under_review: buildQueueEntry(
      "Em revisao",
      underReviewOrderIds,
      "Pedidos que exigem atencao antes da expedicao."
    ),
    collection_ready: buildQueueEntry(
      "Para coleta",
      collectionOrderIds,
      "Pedidos operacionais na fila de coleta."
    ),
    nfe_sync_pending: buildQueueEntry(
      "NF-e com sync pendente",
      nfeSyncPendingOrderIds,
      "Notas autorizadas localmente que ainda precisam refletir com seguranca no ML."
    ),
    nfe_attention: buildQueueEntry(
      "NF-e com bloqueio ou erro",
      nfeAttentionOrderIds,
      "Pedidos com bloqueio fiscal, rejeicao ou configuracao pendente."
    ),
    post_sale_attention: {
      label: "Pos-venda ativo",
      count: Number(postSaleOverview.total_open || 0),
      note:
        "Volume de reclamacoes e devolucoes persistidas localmente para acompanhamento operacional.",
    },
    post_sale_ui_attention: {
      label: "Pos-venda auditado",
      count: Number(postSaleOverview?.private_audit?.totals?.action_required || 0),
      note:
        "Itens auditados na UI privada do Seller Center que exigem acao ou acompanhamento manual.",
    },
  };
}

// ─── Contagens LIVE dos chips (pack-deduplicated) ─────────────────────────
// Busca TODOS os pedidos ativos da API ML, agrupa por pack (como o ML faz),
// e classifica em buckets usando substatus real do ML (/shipments/{id}).
// Retorna { today, upcoming, in_transit, finalized, cancelled } — os números
// exatos que o ML Seller Center mostra nos chips.
//
// ⚠️  ATENÇÃO — DOIS ESPAÇOS DE IDs COEXISTEM NESTE MÓDULO:
//
//   1. DB row id  (ml_orders.id)    — PK do banco, usado pelo frontend (order.id)
//                                     e pelos deposits (deposit.order_ids_by_bucket).
//
//   2. ML order id (ml_orders.order_id) — ID externo da API ML (orders/search).
//                                     Usado nas funções abaixo (deduplicateOrdersToPacks,
//                                     fetchMLLiveChipBucketsDetailed) porque elas operam
//                                     com dados crus da ML API, onde order.id = ML order id.
//
// buildDashboardPayload traduz ML order ids → DB row ids (via mlOrderIdToDbId)
// antes de expor ml_live_chip_order_ids_by_bucket no payload. Se você adicionar
// novos campos com IDs, SEMPRE verifique qual espaço está usando.

const ML_LIVE_PAGE_LIMIT = 50;
const ML_LIVE_MAX_PAGES = 15;
// Cache da classificação LIVE detalhada (counts + order_ids), keyed por
// connection.id para suportar multi-conexão sem colisão. TTL = 50s.
// O cache geral do payload do dashboard (DASHBOARD_CACHE_TTL_MS, 30s) é o
// principal consumidor; esse cache interno absorve chamadas paralelas e o
// hit do endpoint /ml-diagnostics logo após o dashboard.
const liveChipDetailedCache = new Map();
const ML_LIVE_DETAILED_CACHE_TTL_MS = 50 * 1000;

// ── Classificação de ready_to_ship por substatus ──
// ML Seller Center: a MAIORIA dos ready_to_ship aparece em "Envios de hoje".
// Apenas substatuses específicos vão para "Próximos dias" ou são excluídos.
//
// EXCLUÍDOS (transição): picked_up, authorized_by_carrier
//   → Transportador já coletou — entre ready_to_ship e shipped, invisíveis.
// UPCOMING: in_packing_list, in_hub
//   → Agendado para futuro ou em processamento no hub — "Próximos dias".
// DEFAULT (tudo o resto): "Envios de hoje"
//   → ready_for_pickup, in_warehouse, ready_to_pack, packed,
//     invoice_pending, unknown/none, etc.
const RTS_EXCLUDED_SUBSTATUSES = new Set([
  "picked_up", "authorized_by_carrier",
]);
const RTS_UPCOMING_SUBSTATUSES = new Set([
  "in_packing_list", "in_hub",
]);
const TRANSIT_SHIPPED_SUBSTATUSES = new Set([
  "out_for_delivery", "receiver_absent", "not_visited", "at_customs",
]);
// Shipped substatuses que o ML Seller Center coloca em "Próximos dias"
// (o pacote está no ponto de retirada aguardando o comprador).
const SHIPPED_UPCOMING_SUBSTATUSES = new Set([
  "waiting_for_withdrawal",
]);
// Dias máximos desde o envio para considerar "Em trânsito".
// ML Seller Center mostra shipped recentes com tracking ativo.
// 3 dias = janela que cobre o ciclo normal de entrega ML (2-5 dias úteis).
// Shipped mais antigos com substatus ativo são provavelmente stale.
const TRANSIT_MAX_DAYS = 3;

// Busca TODAS as orders de um shipping status com paginação PARALELA.
// 1. Busca página 1 (para obter total)
// 2. Busca TODAS as páginas restantes em paralelo
async function fetchAllOrdersByShippingStatus(token, sellerId, shippingStatus, maxPages = ML_LIVE_MAX_PAGES) {
  const baseUrl = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&shipping.status=${shippingStatus}&sort=date_desc&limit=${ML_LIVE_PAGE_LIMIT}`;
  const headers = { Authorization: `Bearer ${token}` };

  // Página 1: obtém dados + total
  const firstR = await fetch(`${baseUrl}&offset=0`, { headers });
  if (!firstR.ok) return [];
  const firstD = await firstR.json();
  const firstResults = Array.isArray(firstD.results) ? firstD.results : [];
  if (firstResults.length === 0) return [];

  const total = firstD.paging?.total ?? firstResults.length;
  if (total <= ML_LIVE_PAGE_LIMIT) return firstResults;

  // Calcula páginas restantes e busca todas em PARALELO
  const remainingPages = Math.min(
    Math.ceil((total - ML_LIVE_PAGE_LIMIT) / ML_LIVE_PAGE_LIMIT),
    maxPages - 1
  );

  const pagePromises = [];
  for (let i = 0; i < remainingPages; i++) {
    const offset = (i + 1) * ML_LIVE_PAGE_LIMIT;
    if (offset >= total) break;
    pagePromises.push(
      fetch(`${baseUrl}&offset=${offset}`, { headers })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => (Array.isArray(d.results) ? d.results : []))
        .catch(() => [])
    );
  }

  const remainingResults = await Promise.all(pagePromises);
  return [firstResults, ...remainingResults].flat();
}

// Agrupa orders por pack (como ML conta nos chips).
// Chave: pack_id > shipping_id > order_id
//
// ⚠️  ESPAÇO DE IDs: os orders vêm da ML API (orders/search). Logo,
// `order.id` aqui é o **ML order ID externo** (ex: "2000006549182345"),
// NÃO o DB row id (ml_orders.id). O array `pack.ml_order_ids` armazena
// ML order IDs. Se precisar cruzar com dados locais, use o mapa
// mlOrderIdToDbId construído em buildDashboardPayload.
function deduplicateOrdersToPacks(orders) {
  const packs = new Map();
  for (const order of orders) {
    const packId = order.pack_id ? String(order.pack_id) : null;
    const shippingId = order.shipping?.id ? String(order.shipping.id) : null;
    const mlOrderId = String(order.id); // ML API order.id = ML order ID externo
    const key = packId || shippingId || mlOrderId;

    if (!packs.has(key)) {
      packs.set(key, {
        key,
        shipping_id: shippingId,
        shipping_status: "",
        ml_order_ids: [], // ⚠️ ML order IDs, NÃO DB row ids
        date_created: order.date_created,
      });
    }
    const pack = packs.get(key);
    pack.ml_order_ids.push(mlOrderId);
    // Usa o primeiro shipping_id encontrado para o pack
    if (!pack.shipping_id && shippingId) pack.shipping_id = shippingId;
  }
  return packs;
}

// ── Busca substatus em tempo real via /shipments/{id} API ──────────
// Faz chamadas em paralelo com concorrência controlada.
// Retorna Map<shipping_id, { status, substatus, dateShipped }>.
async function fetchShipmentDetails(token, shippingIds, concurrency = 20) {
  const map = new Map();
  const headers = { Authorization: `Bearer ${token}` };
  const ids = [...shippingIds];

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (sid) => {
        try {
          const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers });
          if (!r.ok) return null;
          const j = await r.json();
          return {
            id: String(sid),
            status: (j.status || "").toLowerCase(),
            substatus: (j.substatus || "none").toLowerCase(),
            dateShipped: j.status_history?.date_shipped || null,
          };
        } catch { return null; }
      })
    );
    for (const r of results) {
      if (r) map.set(r.id, r);
    }
  }
  return map;
}

/**
 * Classificação LIVE detalhada dos chips — fonte de verdade do ML Seller Center.
 *
 * Busca todos os pedidos ativos da API ML (pending, ready_to_ship, shipped),
 * agrupa por pack (como o ML conta), e classifica em buckets usando o
 * substatus REAL do shipment (via /shipments/{id}).
 *
 * Retorna counts E os order_ids por bucket — para que o frontend possa
 * usar a MESMA fonte tanto para o número do chip quanto para a lista de
 * cards abaixo. Sem essa paridade, chip e lista divergem (chip mostra 12
 * mas a lista tem 8 cards por usar classificação local diferente).
 *
 * Também usado pelo /api/ml/diagnostics?action=orders-diff para identificar
 * EXATAMENTE quais pedidos estão em buckets diferentes entre ML e app.
 *
 * Cache: 50s por connection.id (liveChipDetailedCache). Reseta via
 * invalidateDashboardCache() quando auto-heal corre.
 *
 * Retorna: {
 *   counts: { today, upcoming, in_transit, finalized, cancelled },
 *   order_ids_by_bucket: { today: Set<string>, upcoming: Set<string>, ... }
 * }
 */
export async function fetchMLLiveChipBucketsDetailed(connection) {
  try {
    // Cache por conexão — 50s. Evita refazer o batch de ML API calls
    // (pending + ready_to_ship + shipped + N shipments + finalized + cancelled)
    // quando dashboard e diagnostics chamam em sequência próxima.
    const cacheKey = String(connection?.id || connection?.seller_id || "default");
    const cached = liveChipDetailedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const validConnection = await ensureValidAccessToken(connection);
    if (!validConnection?.access_token) return null;
    const token = validConnection.access_token;
    const sellerId = String(validConnection.seller_id);
    const todayKey = getCalendarKey(new Date());

    const buckets = {
      today: new Set(),
      upcoming: new Set(),
      in_transit: new Set(),
      finalized: new Set(),
      cancelled: new Set(),
    };

    // ⚠️ IDs armazenados nos buckets são ML order IDs (API externa),
    // NÃO DB row ids. buildDashboardPayload traduz via mlOrderIdToDbId
    // antes de expor ao frontend.
    const addMlOrderIds = (bucket, mlOrderIds) => {
      if (!Array.isArray(mlOrderIds)) return;
      for (const id of mlOrderIds) {
        if (id != null) buckets[bucket].add(String(id));
      }
    };

    const [pendingOrders, rtsOrders, shippedOrders, notDeliveredOrders] = await Promise.all([
      fetchAllOrdersByShippingStatus(token, sellerId, "pending", 5),
      fetchAllOrdersByShippingStatus(token, sellerId, "ready_to_ship", ML_LIVE_MAX_PAGES),
      fetchAllOrdersByShippingStatus(token, sellerId, "shipped", 10),
      fetchAllOrdersByShippingStatus(token, sellerId, "not_delivered", 3),
    ]);

    const pendingPacks = deduplicateOrdersToPacks(pendingOrders);
    const rtsPacks = deduplicateOrdersToPacks(rtsOrders);
    const shippedPacks = deduplicateOrdersToPacks(shippedOrders);
    const ndPacks = deduplicateOrdersToPacks(notDeliveredOrders);

    const allShippingIds = new Set();
    for (const [, pack] of rtsPacks) {
      if (pack.shipping_id) allShippingIds.add(pack.shipping_id);
    }
    for (const [, pack] of shippedPacks) {
      if (pack.shipping_id) allShippingIds.add(pack.shipping_id);
    }
    for (const [, pack] of ndPacks) {
      if (pack.shipping_id) allShippingIds.add(pack.shipping_id);
    }
    const shipmentMap = await fetchShipmentDetails(token, allShippingIds, 20);

    // Pending → upcoming
    for (const [, pack] of pendingPacks) {
      addMlOrderIds("upcoming", pack.ml_order_ids);
    }

    // Ready to ship → classificação por substatus.
    // ML Seller Center: a MAIORIA dos ready_to_ship é "Envios de hoje".
    // Apenas substatuses específicos vão para "Próximos dias" ou são excluídos.
    //
    // IMPORTANTE — tratamento de edge cases:
    // - Sem shipment detail (API falhou): "upcoming" (conservador — sem dados, não adivinha)
    // - Status mudou (ex: ready_to_ship → shipped): SKIP — o loop de shipped já cuida.
    //   Se colocar em "today" aqui, o MESMO pack aparece em "today" E em "in_transit"
    //   porque os fetches paralelos capturam o pack nos dois estados.
    let rtsNoShipment = 0, rtsStatusMismatch = 0;
    for (const [, pack] of rtsPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      if (!shipment) {
        // Sem detalhe do shipment (API falhou/rate-limit) — conservador: upcoming.
        // Não assume "hoje" sem dados — evita inflar o chip.
        rtsNoShipment++;
        addMlOrderIds("upcoming", pack.ml_order_ids);
        continue;
      }
      if (shipment.status !== "ready_to_ship") {
        // Status mudou entre o search e o /shipments/{id} (ex: já virou "shipped").
        // NÃO classificar aqui — o loop correspondente (shipped/pending) cuida.
        // Se colocar em "today", causa double-counting com o loop de shipped.
        rtsStatusMismatch++;
        continue;
      }
      const sub = shipment.substatus;
      if (RTS_EXCLUDED_SUBSTATUSES.has(sub)) {
        // picked_up/authorized_by_carrier: transição → excluído de todos os chips
      } else if (RTS_UPCOMING_SUBSTATUSES.has(sub)) {
        // in_packing_list/in_hub: agendado/hub → "Próximos dias"
        addMlOrderIds("upcoming", pack.ml_order_ids);
      } else {
        // Tudo o resto → "Envios de hoje" (ready_for_pickup, in_warehouse,
        // ready_to_pack, packed, invoice_pending, none, etc.)
        addMlOrderIds("today", pack.ml_order_ids);
      }
    }

    // Shipped → trânsito ou upcoming
    const nowMs = Date.now();
    const msPerDay = 86400000;
    for (const [, pack] of shippedPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      if (!shipment) continue;
      if (shipment.status !== "shipped") continue;
      const sub = shipment.substatus;
      if (SHIPPED_UPCOMING_SUBSTATUSES.has(sub)) {
        addMlOrderIds("upcoming", pack.ml_order_ids);
      } else if (
        TRANSIT_SHIPPED_SUBSTATUSES.has(sub) ||
        sub === "soon_deliver" ||
        sub === "in_transit"
      ) {
        // Sem dateShipped = sem referência temporal → skip (não infla o chip)
        if (!shipment.dateShipped) continue;
        const shippedAt = new Date(shipment.dateShipped).getTime();
        if (Number.isNaN(shippedAt)) continue;
        const ageDays = (nowMs - shippedAt) / msPerDay;
        if (ageDays <= TRANSIT_MAX_DAYS) {
          addMlOrderIds("in_transit", pack.ml_order_ids);
        }
      }
    }

    // Not delivered com logística ainda ativa → "Em trânsito" (não "Finalizadas")
    // Ex: returning_to_sender, returning_to_hub, delayed, return_failed
    for (const [, pack] of ndPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      if (shipment && NOT_DELIVERED_IN_TRANSIT_SUBSTATUSES.has(shipment.substatus)) {
        addMlOrderIds("in_transit", pack.ml_order_ids);
      }
    }

    // Finalizadas: not_delivered de hoje (excluindo os que já estão em in_transit)
    // NOTA: NÃO incluir "delivered" aqui — ML "Finalizadas" conta apenas
    // problemas de entrega (not_delivered), não entregas normais do dia.
    try {
      const todayISO = todayKey + "T00:00:00.000-03:00";
      const ndR = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${sellerId}` +
          `&shipping.status=not_delivered&order.date_last_updated.from=${todayISO}&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.json()).catch(() => ({ results: [] }));
      for (const order of (ndR.results || [])) {
        if (!order?.id) continue;
        const orderId = String(order.id);
        // Não duplicar: se já foi classificado como in_transit (returning_to_sender etc.)
        if (!buckets.in_transit.has(orderId)) {
          buckets.finalized.add(orderId);
        }
      }
    } catch {
      // deixa vazio se falhar
    }

    // Canceladas: busca IDs reais (cancelled a partir do piso)
    try {
      const cancelFromIso = `${MIN_CANCELLED_DATE_FROM}T00:00:00.000-03:00`;
      const cUrl =
        `https://api.mercadolibre.com/orders/search?seller=${sellerId}` +
        `&order.status=cancelled&order.date_created.from=${encodeURIComponent(cancelFromIso)}&limit=50`;
      const cR = await fetch(cUrl, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      const results = Array.isArray(cR.results) ? cR.results : [];
      for (const order of results) {
        if (order?.id) buckets.cancelled.add(String(order.id));
      }
    } catch {
      // deixa vazio se falhar
    }

    const result = {
      counts: {
        today: buckets.today.size,
        upcoming: buckets.upcoming.size,
        in_transit: buckets.in_transit.size,
        finalized: buckets.finalized.size,
        cancelled: buckets.cancelled.size,
      },
      order_ids_by_bucket: buckets,
    };

    // Diagnóstico: log da classificação para validar contra ML Seller Center
    console.log(
      `[ML Live Chips] seller=${sellerId}` +
        ` | fetched: pending=${pendingOrders.length} rts=${rtsOrders.length}` +
        ` shipped=${shippedOrders.length} nd=${notDeliveredOrders.length}` +
        ` | packs: pending=${pendingPacks.size} rts=${rtsPacks.size}` +
        ` shipped=${shippedPacks.size} nd=${ndPacks.size}` +
        ` | shipments: ${shipmentMap.size}/${allShippingIds.size}` +
        ` (rts_no_shipment=${rtsNoShipment} rts_status_mismatch=${rtsStatusMismatch})` +
        ` | RESULT: today=${result.counts.today} upcoming=${result.counts.upcoming}` +
        ` in_transit=${result.counts.in_transit} finalized=${result.counts.finalized}` +
        ` cancelled=${result.counts.cancelled}`
    );

    liveChipDetailedCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + ML_LIVE_DETAILED_CACHE_TTL_MS,
    });
    return result;
  } catch (err) {
    console.error("[fetchMLLiveChipBucketsDetailed] Error:", err.message);
    return null;
  }
}

export async function buildDashboardPayload(options = {}) {
  const allowCache = options.allowCache !== false;

  if (allowCache) {
    const cachedPayload = readDashboardCache();
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const baseConnection = getLatestConnection();
  const sellerCenterMirrorOverview = getSellerCenterMirrorOverview(
    baseConnection?.seller_id || null
  );
  const postSaleOverview = buildPostSaleOverview(baseConnection?.seller_id || null);

  if (!baseConnection?.id) {
    const emptyPayload = {
      backend_secure: true,
      generated_at: new Date().toISOString(),
      internal_operational: buildInternalOperationalLayerMetadata(),
      seller_center_mirror: sellerCenterMirrorOverview,
      post_sale_overview: postSaleOverview,
      operational_queues: buildOperationalQueues([], null, postSaleOverview),
      deposits: [],
    };

    if (allowCache) {
      writeDashboardCache(emptyPayload);
    }

    return emptyPayload;
  }

  const today = new Date();
  const todayKey = getCalendarKey(today);
  const allOrders = fetchStoredOrders();

  // Filtro de freshness: remove pedidos com status operacional provavelmente
  // desatualizado ("stale"). Quando o sync não re-busca pedidos antigos,
  // eles ficam presos em status transitórios (paid, shipped) mesmo que já
  // tenham sido entregues/cancelados. O ML Seller Center os remove automaticamente.
  //
  // Regras de freshness (baseadas no ciclo de vida típico do ML):
  //   - "paid"/"pending"/"confirmed": stale depois de 14 dias
  //   - "ready_to_ship": stale depois de 30 dias
  //   - "shipped"/"in_transit": stale depois de 45 dias
  //   - "delivered"/"cancelled"/"not_delivered"/"returned": sem limite (status final)
  // Thresholds para detectar dados stale. Para shipped/in_transit, usa
  // date_shipped (data real de envio), não sale_date. Entrega ML = 2-5 dias.
  // Com active refresh (5 min), dados ficam frescos rapidamente.
  // Thresholds mais agressivos para eliminar pedidos fantasma.
  const STALE_THRESHOLDS_DAYS = {
    paid: 7,
    pending: 7,
    confirmed: 7,
    handling: 7,
    ready_to_ship: 21,
    shipped: 5,
    in_transit: 5,
    not_delivered: 10,
  };
  const orders = allOrders.filter((order) => {
    const saleDate = order.sale_date ? new Date(order.sale_date) : null;
    if (!saleDate) return false;

    const snapshot = getShipmentSnapshot(order);
    const shipmentStatus = normalizeState(
      snapshot.status || order.order_status || "",
      ""
    );
    const thresholdDays = STALE_THRESHOLDS_DAYS[shipmentStatus];

    // Status finais (delivered, cancelled, etc.) ou desconhecidos: sem filtro de freshness
    if (thresholdDays == null) return true;

    // Para shipped/in_transit: usar data de envio (não data de venda)
    let referenceDate = saleDate;
    if (shipmentStatus === "shipped" || shipmentStatus === "in_transit") {
      const statusHistory = snapshot.status_history || {};
      const shippedDate = statusHistory.date_shipped ? new Date(statusHistory.date_shipped) : null;
      if (shippedDate && !isNaN(shippedDate.getTime())) {
        referenceDate = shippedDate;
      }
    }

    const ageMs = today.getTime() - referenceDate.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return ageDays <= thresholdDays;
  });

  const depositsMap = new Map();
  const countedPacks = new Set();

    for (const order of orders) {
      const depositInfo = getDepositInfo(order);
      if (!depositsMap.has(depositInfo.key)) {
        depositsMap.set(depositInfo.key, buildEmptyDepositEntry(depositInfo));
      }

      const deposit = depositsMap.get(depositInfo.key);
      deposit._orders.push(order);

      const bucket =
        depositInfo.logisticType === "fulfillment"
          ? classifyFulfillmentOrder(order, todayKey, null)
          : classifyCrossDockingOrder(order, todayKey);

      // Finalizadas: só mostra pedidos cancelados/devolvidos recentes.
      // ML Seller Center mostra apenas finalizações do dia atual.
      // Usa a DATA DA EXCEÇÃO (date_cancelled, date_not_delivered, date_returned).
      if (bucket === "finalized") {
        const snapshot = getShipmentSnapshot(order);
        const statusHistory = snapshot.status_history || {};
        const exceptionDateKey =
          getDateKey(statusHistory.date_cancelled) ||
          getDateKey(statusHistory.date_not_delivered) ||
          getDateKey(statusHistory.date_returned) ||
          getDateKey(order.sale_date);
        // ML mostra apenas finalizações de hoje (mesmo dia calendário)
        if (!exceptionDateKey || exceptionDateKey < todayKey) {
          continue;
        }
      }

      if (!bucket || !OPERATIONAL_BUCKETS.includes(bucket)) {
        // Keep walking. Native ML buckets are computed separately.
      } else {
        const packId = order.raw_data?.pack_id ? String(order.raw_data.pack_id) : null;
        // Dedup global por pack+bucket (não por depósito) — o mesmo pack
        // não pode ser contado 2x mesmo que apareça em depósitos diferentes
        const packDedupeKey = packId ? `${bucket}:${packId}` : null;
        const isPackAlreadyCounted = packDedupeKey && countedPacks.has(packDedupeKey);

        // Always track order IDs (for grid display).
        // ⚠️ order.id aqui é DB row id (fetchStoredOrders), NÃO ML order id.
        deposit.order_ids_by_bucket[bucket].push(order.id);
        deposit.native_order_ids_by_bucket[bucket].push(order.id);

        // Only increment count once per pack (or always for non-pack orders)
        if (!isPackAlreadyCounted) {
          deposit.counts[bucket] += 1;
          deposit.native_counts[bucket] += 1;
          if (packDedupeKey) countedPacks.add(packDedupeKey);
        }
      }
    }

  // Garantir que "Vendas sem deposito" sempre apareca no filtro do frontend
  // (mesmo vazio), espelhando o comportamento do ML Seller Center.
  if (!depositsMap.has("without-deposit")) {
    depositsMap.set("without-deposit", buildEmptyDepositEntry(buildFallbackWithoutDepositInfo()));
  }

  const deposits = Array.from(depositsMap.values())
    .map((deposit) => {
        const summaryRowsByBucket = {
          today:
            deposit.logistic_type === "fulfillment"
              ? buildFulfillmentSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.today.includes(order.id)),
                  "today"
                )
              : buildCrossDockingSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.today.includes(order.id)),
                  todayKey
                ),
          upcoming:
            deposit.logistic_type === "fulfillment"
              ? buildFulfillmentSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.upcoming.includes(order.id)),
                  "upcoming"
                )
              : buildCrossDockingSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.upcoming.includes(order.id)),
                  todayKey
                ),
          in_transit:
            deposit.logistic_type === "fulfillment"
              ? buildFulfillmentSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.in_transit.includes(order.id)),
                  "in_transit"
                )
              : buildCrossDockingSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.in_transit.includes(order.id)),
                  todayKey
                ),
          finalized:
            deposit.logistic_type === "fulfillment"
              ? buildFulfillmentSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.finalized.includes(order.id)),
                  "finalized"
                )
              : buildCrossDockingSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.finalized.includes(order.id)),
                  todayKey
                ),
          cancelled:
            deposit.logistic_type === "fulfillment"
              ? buildFulfillmentSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.cancelled.includes(order.id)),
                  "cancelled"
                )
              : buildCrossDockingSummaryRows(
                  deposit._orders.filter((order) => deposit.order_ids_by_bucket.cancelled.includes(order.id)),
                  todayKey
                ),
        };

        const totalCount = Object.values(deposit.counts).reduce(
          (total, count) => total + (count || 0),
          0
        );
        const nativeTotalCount = Object.values(deposit.native_counts).reduce(
          (total, count) => total + (count || 0),
          0
        );

      return {
        key: deposit.key,
        label: deposit.label,
        logistic_type: deposit.logistic_type,
        lane: deposit.lane,
        headline: deposit.headline,
        internal_operational_counts: deposit.counts,
        internal_operational_order_ids_by_bucket: deposit.order_ids_by_bucket,
        internal_operational_source: deposit.operational_source,
        internal_operational_total_count: totalCount,
        internal_operational_summary_rows: summaryRowsByBucket.today,
        internal_operational_summary_rows_by_bucket: summaryRowsByBucket,
        seller_center_mirror_counts: deposit.native_counts,
        seller_center_mirror_order_ids_by_bucket: deposit.native_order_ids_by_bucket,
        seller_center_mirror_source: deposit.native_source,
        seller_center_mirror_total_count: nativeTotalCount,
        seller_center_mirror_status: sellerCenterMirrorOverview.status,
        seller_center_mirror_note: sellerCenterMirrorOverview.note,
        counts: deposit.counts,
        native_counts: deposit.native_counts,
        order_ids_by_bucket: deposit.order_ids_by_bucket,
        native_order_ids_by_bucket: deposit.native_order_ids_by_bucket,
        operational_source: deposit.operational_source,
        native_source: deposit.native_source,
        total_count: totalCount,
        native_total_count: nativeTotalCount,
        summary_rows: summaryRowsByBucket.today,
        summary_rows_by_bucket: summaryRowsByBucket,
      };
    })
    .filter((deposit) => deposit.total_count > 0 || deposit.native_total_count > 0)
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

  const operationalQueues = buildOperationalQueues(
    orders,
    baseConnection.seller_id,
    postSaleOverview
  );

  // ─── Classificação LIVE dos chips (ML = fonte de verdade) ───
  // Busca a classificação detalhada (counts + order_ids por bucket) de TODAS
  // as conexões e agrega num único mapa global.
  //
  // Expõe DOIS campos correlatos no payload:
  //   - ml_live_chip_counts:              { today, upcoming, in_transit, finalized, cancelled }
  //   - ml_live_chip_order_ids_by_bucket: mesmos buckets, listas de order_ids
  //
  // O frontend usa os counts direto nos chips e os IDs para filtrar a lista
  // de pedidos abaixo do chip selecionado — garantindo que número do chip E
  // os cards listados sigam a mesma fonte de verdade (ML Seller Center).
  let mlLiveChipCounts = null;
  let mlLiveChipOrderIds = null;
  try {
    const allConnections = listConnections().filter((c) => c?.id);
    const detailedPromises = allConnections.map((c) =>
      fetchMLLiveChipBucketsDetailed(c).catch(() => null)
    );
    const detailedResults = (await Promise.all(detailedPromises)).filter(Boolean);
    if (detailedResults.length > 0) {
      const mergedIds = {
        today: new Set(),
        upcoming: new Set(),
        in_transit: new Set(),
        finalized: new Set(),
        cancelled: new Set(),
      };
      for (const result of detailedResults) {
        const ids = result.order_ids_by_bucket || {};
        for (const bucket of Object.keys(mergedIds)) {
          const src = ids[bucket];
          if (!src) continue;
          const iter = src instanceof Set ? src.values() : src;
          for (const id of iter) mergedIds[bucket].add(String(id));
        }
      }

      // Counts ficam inalterados — fonte de verdade ML para os chips.
      mlLiveChipCounts = {
        today: mergedIds.today.size,
        upcoming: mergedIds.upcoming.size,
        in_transit: mergedIds.in_transit.size,
        finalized: mergedIds.finalized.size,
        cancelled: mergedIds.cancelled.size,
      };

      // ── TRADUÇÃO DE IDs ──────────────────────────────────────────
      // fetchMLLiveChipBucketsDetailed retorna ML order_ids (ex: "2000006549182345")
      // porque vem da API ML (orders/search). Mas o frontend e o deposit
      // classification usam o DB row id (coluna `id` de ml_orders, ex: "150").
      // Se expusermos ML order_ids direto no payload, o frontend faz
      // operationalOrderIds.has(order.id) e NADA bate — lista vem vazia.
      //
      // Solução: traduzir ML order_id → DB row id usando allOrders (que já
      // está carregado). Pedidos que o ML classifica mas ainda não estão
      // sincronizados no DB são silenciosamente ignorados — vão aparecer
      // assim que o próximo sync/auto-heal os trouxer.
      const mlOrderIdToDbId = new Map();
      for (const order of allOrders) {
        if (order.order_id) {
          mlOrderIdToDbId.set(String(order.order_id), String(order.id));
        }
      }

      const translateIds = (idSet) =>
        Array.from(idSet)
          .map((mlId) => mlOrderIdToDbId.get(mlId))
          .filter(Boolean);

      mlLiveChipOrderIds = {
        today: translateIds(mergedIds.today),
        upcoming: translateIds(mergedIds.upcoming),
        in_transit: translateIds(mergedIds.in_transit),
        finalized: translateIds(mergedIds.finalized),
        cancelled: translateIds(mergedIds.cancelled),
      };
    }
  } catch {
    mlLiveChipCounts = null;
    mlLiveChipOrderIds = null;
  }

  const payload = {
    backend_secure: true,
    generated_at: new Date().toISOString(),
    internal_operational: buildInternalOperationalLayerMetadata(),
    seller_center_mirror: sellerCenterMirrorOverview,
    post_sale_overview: postSaleOverview,
    operational_queues: operationalQueues,
    deposits,
    // Contagens LIVE dos chips — ML API como fonte de verdade.
    // Pack-deduplicated, classificado por substatus real do ML.
    // Se null, o frontend usa counts dos deposits (fallback local).
    ml_live_chip_counts: mlLiveChipCounts,
    // Listas de order_ids classificadas pelo ML (mesma fonte dos counts).
    // Frontend usa para filtrar a lista de pedidos abaixo do chip selecionado,
    // evitando divergência entre o número do chip e os cards exibidos.
    ml_live_chip_order_ids_by_bucket: mlLiveChipOrderIds,
  };

  if (allowCache) {
    writeDashboardCache(payload);
  }

  return payload;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);
    const payload = await buildDashboardPayload({ allowCache: true });
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      backend_secure: true,
    });
  }
}

export const __dashboardTestables = {
  classifyCrossDockingOrder,
  classifyNativeMercadoLivreOrder,
  classifySellerCenterMirrorEntity,
  isSellerCenterMirrorFinalStatus,
  isOrderForCollection,
  isOrderUnderReview,
};
