import { db } from "../_lib/db.js";
import { getLatestConnection, getOrderSummariesByScope, listConnections } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { isBrazilianBusinessDay } from "../_lib/business-days.js";
import { fetchMLChipCountsDirect } from "./_lib/ml-chip-proxy.js";
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

// Status ativos para o dashboard.
// Inclui "delivered" pra que entregas recentes apareçam em "Finalizadas"
// (com janela de 7 dias aplicada no loop). Sem isso, 95% dos delivered
// (histórico) ficariam filtrados mas os recentes também seriam perdidos.
// O filtro de 7 dias por date_closed garante que só os recentes contam.
const DASHBOARD_ACTIVE_STATUSES = [
  "pending", "handling", "ready_to_ship", "confirmed", "paid",
  "shipped", "in_transit", "delivered", "not_delivered", "returned", "cancelled",
];

function fetchStoredOrders(connectionId = null, limit = null) {
  // Query otimizada: filtra no SQL para carregar apenas pedidos relevantes.
  // Antes: carregava 10k+ rows (incluindo 9k delivered). Agora: ~400 rows.
  // Filtra por connection_id para não misturar pedidos de contas ML diferentes.
  const placeholders = DASHBOARD_ACTIVE_STATUSES.map(() => "?").join(", ");
  const connectionFilter = connectionId ? "AND connection_id = ?" : "";

  // Janela pra delivered: usa sale_date OU date_delivered (o mais recente).
  //
  // Antes: apenas `sale_date > cutoff_15d`. Problema: um pedido vendido
  // ha 20 dias e entregue HOJE (entrega tardia) era filtrado, apesar
  // do ML ainda mostra-lo em "Finalizadas" pela date_delivered recente.
  // Efeito: override ML nao conseguia recuperar esses pedidos e o diff
  // persistia com ~4 missing→finalized nos logs.
  //
  // Fix: deixar passar se EITHER sale_date > cutoff OR date_delivered
  // > cutoff. Janela do delivered pode ser maior (30d) pra cobrir todas
  // as entregas que o ML ainda lista no chip (observado em prod: ML
  // mantem ~2-3 dias, mas pedidos podem entrar/sair conforme substatus).
  const deliveredSaleCutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const deliveredDateCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Ordem dos params deve bater com os "?" na query:
  // 1. statuses (IN placeholders)
  // 2. deliveredSaleCutoff
  // 3. deliveredDateCutoff
  // 4. connectionId (se tiver)
  const params = [...DASHBOARD_ACTIVE_STATUSES, deliveredSaleCutoff, deliveredDateCutoff];
  if (connectionId) params.push(String(connectionId));

  const rows = db.prepare(`
    WITH filtered AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY COALESCE(sale_date, '') DESC, id ASC) AS rn,
        COUNT(*) OVER (PARTITION BY order_id) AS grouped_items_count,
        SUM(COALESCE(quantity, 0)) OVER (PARTITION BY order_id) AS grouped_quantity_total,
        SUM(COALESCE(amount, 0)) OVER (PARTITION BY order_id) AS grouped_amount_total
      FROM ml_orders
      WHERE lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) IN (${placeholders})
        AND (
          lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) != 'delivered'
          OR sale_date > ?
          OR json_extract(raw_data, '$.shipment_snapshot.status_history.date_delivered') > ?
        )
        ${connectionFilter}
    )
    SELECT * FROM filtered WHERE rn = 1
    ORDER BY COALESCE(sale_date, '') DESC, order_id DESC
    ${limit != null ? `LIMIT ${Math.max(0, Number(limit) || 0)}` : ""}
  `).all(...params);

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

  // Cancelamento: ML Seller Center UI conta cancelados de hoje em "Finalizadas".
  // Nossa classificação agora redireciona pra "finalized" e o filtro de data
  // (linha ~1983 do loop principal) mantém só os de hoje.
  const rawOrderStatus = normalizeState(
    order.raw_data?.status || order.order_status || ""
  );
  if (rawOrderStatus === "cancelled") {
    return "finalized";
  }

  // shipping.status=pending: pedido pago aguardando processamento.
  // Comportamento conservador: SEMPRE "Próximos dias". ML UI mostra pending
  // em "Próximos dias" na maioria dos casos. Tentativa anterior de usar SLA
  // pra promover pra "hoje" estava agressiva demais (inflava Envios de hoje
  // com pedidos ainda não-operacionais).
  if (status === "pending") {
    return "upcoming";
  }

  // ready_to_ship e handling são os status operacionais principais.
  if (status === "ready_to_ship" || status === "handling") {
    // Pedido retirado pelo transportador — em trânsito
    if (CROSS_DOCKING_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }

    // Substatuses que SEMPRE vão pra "Envios de hoje" (prontos):
    if (
      substatus === "ready_for_pickup" ||
      substatus === "packed" ||
      substatus === "ready_to_pack"
    ) {
      return "today";
    }

    // ALINHAMENTO ML (4a auditoria via screenshots — 2026-04-23):
    // - in_hub: pacote JA saiu, esta no hub do carrier → "Em trânsito"
    //   (ML mostra CARD_IN_THE_WAY "A caminho")
    // - in_packing_list: pacote ja com carrier sendo empacotado → "Em trânsito"
    //   (ML mostra "A caminho"). NOTA: so pra CROSS-DOCKING — Full tem outra regra.
    if (substatus === "in_hub" || substatus === "in_packing_list") {
      return "in_transit";
    }

    // invoice_pending: aguardando NF-e → "Proximos dias"
    if (substatus === "invoice_pending") {
      return "upcoming";
    }

    // in_warehouse no cross-docking (raro) → "Proximos dias"
    if (substatus === "in_warehouse") {
      return "upcoming";
    }

    // ready_to_print → "Envios de hoje" (precisa imprimir antes da coleta)
    if (substatus === "ready_to_print") {
      return "today";
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
  // ALINHAMENTO COM ML: shipped/waiting_for_withdrawal → "upcoming"
  // (fetchMLLiveChipBucketsDetailed linha 1753).
  if (status === "shipped") {
    // ALINHAMENTO ML (4a auditoria): waiting_for_withdrawal → "Em trânsito"
    // (CARD_WAITING_FOR_WITHDRAWAL vive na aba in_transit do Seller Center,
    // NAO em upcoming como estava)
    if (substatus === "waiting_for_withdrawal") {
      return "in_transit";
    }
    if (SHIPPED_UPCOMING_SUBSTATUSES.has(substatus)) {
      return "upcoming";
    }
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      // Só conta como "Em trânsito" se shipped nos últimos 7 dias (antes 2)
      // ML mostra pedidos shipped em in_transit ate a entrega, sem filtro forte.
      const shippedAge = dates.shippedDateKey
        ? (new Date(todayKey + "T12:00:00-03:00").getTime() - new Date(dates.shippedDateKey + "T12:00:00-03:00").getTime()) / 86400000
        : 999;
      return shippedAge <= 7 ? "in_transit" : null;
    }
    // ALINHAMENTO ML (4a auditoria): shipped SEM substatus → "Em trânsito"
    // ML mostra esses em CARD_IN_THE_WAY "A caminho". Janela de 7 dias.
    if ((!substatus || substatus === "none") && dates.shippedDateKey) {
      const shippedAge =
        (new Date(todayKey + "T12:00:00-03:00").getTime() -
          new Date(dates.shippedDateKey + "T12:00:00-03:00").getTime()) /
        86400000;
      return shippedAge <= 7 ? "in_transit" : null;
    }
    return null;
  }

  // "in_transit" como status direto — ALINHADO COM ML: não contar.
  // O ML Seller Center NÃO busca in_transit como shipping.status separado
  // (fetchMLLiveChipBucketsDetailed só busca pending, ready_to_ship, shipped,
  // not_delivered). Pedidos com status=in_transit no DB local são
  // normalmente dados stale — o ML já mudou pra "delivered" mas o app
  // não sincronizou. Retornar null pra não inflar o chip.
  if (status === "in_transit") {
    return null;
  }

  // not_delivered: SEMPRE finalized. No ML Seller Center, pedidos com entrega
  // falha (devoluções, perdidos, etc.) aparecem em "Gerenciar Pós-venda"
  // e "Finalizadas", NUNCA em "Em trânsito". Trânsito é só envio ativo.
  if (status === "not_delivered") {
    return "finalized";
  }

  // Cancelled via shipment.status: ML UI conta em Finalizadas (filtro de data).
  if (status === "cancelled") {
    return "finalized";
  }

  // Devolvidas ficam em Finalizadas (pos-venda concluido).
  if (status === "returned") {
    return "finalized";
  }

  // Delivered recente → Finalizadas (ML Seller Center conta entregas recentes
  // em "Finalizadas"). Janela aplicada pelo filtro de 7 dias no loop principal.
  if (status === "delivered") {
    return "finalized";
  }

  // paid, pending, confirmed e outros → não operacional
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

  // Cancelamento: ML UI conta em Finalizadas (filtro de data aplicado depois).
  const rawOrderStatus = normalizeState(
    order.raw_data?.status || order.order_status || ""
  );
  if (rawOrderStatus === "cancelled") {
    return "finalized";
  }

  // shipping.status=pending: pedido pago aguardando processamento.
  // Comportamento conservador: sempre upcoming. Pending no fulfillment está
  // com ML processando — não é ação do vendedor hoje.
  if (status === "pending") {
    return "upcoming";
  }

  // Fulfillment: ready_to_ship e handling são os status operacionais principais.
  // Alinhado com ML UI — ready_to_print/in_packing_list com SLA hoje → today.
  if (status === "ready_to_ship" || status === "handling") {
    // Sempre "Envios de hoje" (pronto para envio/coleta)
    if (
      substatus === "ready_for_pickup" ||
      substatus === "packed" ||
      substatus === "ready_to_pack"
    ) {
      return "today";
    }

    // ALINHAMENTO ML (4a auditoria): in_hub Full → "Em trânsito"
    // (pacote ja saiu do warehouse ML, esta com carrier)
    if (substatus === "in_hub") {
      return "in_transit";
    }

    // invoice_pending → upcoming (aguarda NF-e)
    if (substatus === "invoice_pending") {
      return "upcoming";
    }

    // ALINHAMENTO ML (4a auditoria): Full in_warehouse/in_packing_list →
    // "Envios de hoje". ML mostra labels "Processando CD" / "Vamos enviar
    // dia X" / "Vamos enviar amanha" — CARD_FULL vive em TAB_TODAY.
    // Diferente do cross_docking que manda in_packing_list pra in_transit.
    if (
      substatus === "in_warehouse" ||
      substatus === "ready_to_print" ||
      substatus === "in_packing_list"
    ) {
      return "today";
    }

    // Substatuses desconhecidos: usa SLA (fallback conservador)
    if (dates.operationalDueDateKey) {
      return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
        ? "today"
        : "upcoming";
    }
    return "upcoming";
  }

  // Fulfillment: mesma lógica do cross-docking shipped.
  if (status === "shipped") {
    // ALINHAMENTO ML (4a auditoria): waiting_for_withdrawal → in_transit
    if (substatus === "waiting_for_withdrawal") {
      return "in_transit";
    }
    if (SHIPPED_UPCOMING_SUBSTATUSES.has(substatus)) {
      return "upcoming";
    }
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      const shippedAge = dates.shippedDateKey
        ? (new Date(todayKey + "T12:00:00-03:00").getTime() - new Date(dates.shippedDateKey + "T12:00:00-03:00").getTime()) / 86400000
        : 999;
      return shippedAge <= 7 ? "in_transit" : null;
    }
    // ALINHAMENTO ML (4a auditoria): shipped Full sem substatus → in_transit
    // (agente achou 7 pedidos Full assim → nosso classifier retornava null)
    if ((!substatus || substatus === "none") && dates.shippedDateKey) {
      const shippedAge =
        (new Date(todayKey + "T12:00:00-03:00").getTime() -
          new Date(dates.shippedDateKey + "T12:00:00-03:00").getTime()) /
        86400000;
      return shippedAge <= 7 ? "in_transit" : null;
    }
    return null;
  }

  // Fulfillment in_transit: ALINHADO COM ML — não contar.
  // (Mesma justificativa do cross_docking: ML não busca in_transit como
  // shipping.status, dados com esse status no DB são stale.)
  if (status === "in_transit") {
    return null;
  }

  // not_delivered: SEMPRE finalized (pós-venda, não trânsito)
  if (status === "not_delivered") {
    return "finalized";
  }

  if (status === "cancelled") {
    return "finalized";
  }

  if (status === "returned") {
    return "finalized";
  }

  // Delivered recente → Finalizadas (mesma lógica do cross_docking).
  if (status === "delivered") {
    return "finalized";
  }

  // paid, pending, confirmed e outros → não operacional
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
  let labelsToPrint = 0;
  let processing = 0;
  let defaultShipping = 0;
  let waitingPickup = 0;
  let inTransitCollection = 0;
  let deliveredOk = 0;
  let notDelivered = 0;
  let complaints = 0;

  for (const order of orders) {
    const { status, substatus } = getShipmentStatus(order);

    // Canceladas (status final)
    if (FINAL_EXCEPTION_STATUSES.has(status) && status === "cancelled") {
      cancelled += 1;
      continue;
    }

    // Devoluções / reclamações (not_delivered, returned)
    if (status === "not_delivered") {
      notDelivered += 1;
      continue;
    }
    if (status === "returned") {
      complaints += 1;
      continue;
    }

    // NF-e pendente
    if (isOrderInvoicePending(order)) {
      invoicePending += 1;
      continue;
    }

    // Etiquetas para imprimir (ready_to_print)
    if (substatus === "ready_to_print") {
      labelsToPrint += 1;
      continue;
    }

    // Em processamento (in_warehouse, ready_to_pack, packed, in_packing_list)
    if (
      substatus === "in_warehouse" ||
      substatus === "ready_to_pack" ||
      substatus === "packed" ||
      substatus === "in_packing_list"
    ) {
      processing += 1;
      continue;
    }

    // Em trânsito — para retirar (waiting_for_withdrawal)
    if (status === "shipped" && substatus === "waiting_for_withdrawal") {
      waitingPickup += 1;
      continue;
    }

    // Em trânsito — coleta (shipped normal, out_for_delivery)
    if (status === "shipped" && (substatus === "out_for_delivery" || substatus === "none")) {
      inTransitCollection += 1;
      continue;
    }

    // Prontas para enviar (ready_for_pickup + NFe emitida)
    if (isOrderReadyToPrintLabel(order)) {
      ready += 1;
      continue;
    }

    // Por envio padrão (pending sem label)
    if (status === "pending" || substatus === "pending") {
      defaultShipping += 1;
      continue;
    }

    // Atrasadas
    if (isOrderOverdue(order, todayKey)) {
      overdue += 1;
    }
  }

  const rows = [
    { key: "cancelled", label: "Canceladas. Nao enviar", count: cancelled },
    { key: "overdue", label: "Atrasadas. Enviar", count: overdue },
    { key: "invoice_pending", label: "NF-e para gerenciar", count: invoicePending },
    { key: "labels_to_print", label: "Etiquetas para imprimir", count: labelsToPrint },
    { key: "processing", label: "Em processamento", count: processing },
    { key: "default_shipping", label: "Por envio padrao", count: defaultShipping },
    { key: "ready", label: "Prontas para enviar", count: ready },
    { key: "waiting_pickup", label: "Esperando retirada do comprador", count: waitingPickup },
    { key: "in_transit_collection", label: "A caminho - Coleta", count: inTransitCollection },
    { key: "not_delivered", label: "Nao entregues", count: notDelivered },
    { key: "complaints", label: "Com reclamacao ou mediacao", count: complaints },
  ];

  // Retorna só linhas com contagem > 0 (igual ML Seller Center faz)
  return rows.filter((r) => r.count > 0);
}

function buildFulfillmentSummaryRows(orders, activeBucket) {
  // Para Full, subcategorias dependem do bucket ativo
  if (activeBucket === "today" || activeBucket === "upcoming") {
    // Hoje / Próximos dias para Full = "No centro de distribuição" (tudo junto)
    return [{ key: "fulfillment_warehouse", label: "No centro de distribuicao", count: orders.length }];
  }

  if (activeBucket === "in_transit") {
    let waitingPickup = 0;
    let fullInTransit = 0;
    for (const order of orders) {
      const { substatus } = getShipmentStatus(order);
      if (substatus === "waiting_for_withdrawal") waitingPickup += 1;
      else fullInTransit += 1;
    }
    return [
      { key: "waiting_pickup", label: "Esperando retirada do comprador", count: waitingPickup },
      { key: "fulfillment_in_transit", label: "A caminho - Full", count: fullInTransit },
    ].filter((r) => r.count > 0);
  }

  if (activeBucket === "finalized") {
    let complaints = 0, delivered = 0, notDelivered = 0, cancelled = 0;
    let returnsCompleted = 0, returnsIncomplete = 0;
    for (const order of orders) {
      const { status, substatus } = getShipmentStatus(order);
      if (status === "cancelled") { cancelled += 1; continue; }
      if (status === "returned") {
        if (substatus === "completed" || substatus === "delivered") returnsCompleted += 1;
        else returnsIncomplete += 1;
        complaints += 1;
        continue;
      }
      if (status === "not_delivered") { notDelivered += 1; continue; }
      if (status === "delivered") { delivered += 1; continue; }
    }
    return [
      { key: "complaints", label: "Com reclamacao ou mediacao", count: complaints },
      { key: "delivered", label: "Entregues", count: delivered },
      { key: "not_delivered", label: "Nao entregues", count: notDelivered },
      { key: "cancelled", label: "Canceladas", count: cancelled },
      { key: "returns_completed", label: "Devolucoes concluidas", count: returnsCompleted },
      { key: "returns_incomplete", label: "Devolucoes nao concluidas", count: returnsIncomplete },
    ].filter((r) => r.count > 0);
  }

  if (activeBucket === "cancelled") {
    return [{ key: "cancelled", label: "Canceladas", count: orders.length }];
  }

  return [{ key: "fulfillment_warehouse", label: "No centro de distribuicao", count: orders.length }];
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
// Shipped substatuses que o ML Seller Center coloca em "Próximos dias"
// (o pacote está no ponto de retirada aguardando o comprador).
const SHIPPED_UPCOMING_SUBSTATUSES = new Set([
  "waiting_for_withdrawal",
]);

// Busca TODAS as orders de um shipping status com paginação PARALELA.
// 1. Busca página 1 (para obter total)
// 2. Busca TODAS as páginas restantes em paralelo
//
// dateFrom: filtra pedidos criados a partir dessa data (ISO string).
// O ML Seller Center aplica "Últimos 2 meses" por padrão — sem esse filtro,
// a API retorna pedidos antigos presos em ready_to_ship/shipped, inflando
// os chips. Padrão: 60 dias atrás (alinhado com o Seller Center).
async function fetchAllOrdersByShippingStatus(token, sellerId, shippingStatus, maxPages = ML_LIVE_MAX_PAGES, dateFrom = null) {
  const effectiveDateFrom = dateFrom || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&shipping.status=${shippingStatus}&sort=date_desc&limit=${ML_LIVE_PAGE_LIMIT}&order.date_created.from=${encodeURIComponent(effectiveDateFrom)}`;
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
        // SLA usado pelo ML UI pra classificar pending (today vs upcoming)
        sla_iso:
          order.shipping?.estimated_delivery_limit?.date ||
          (typeof order.shipping?.estimated_delivery_limit === "string"
            ? order.shipping.estimated_delivery_limit
            : null) ||
          order.shipping?.estimated_delivery_final?.date ||
          (typeof order.shipping?.estimated_delivery_final === "string"
            ? order.shipping.estimated_delivery_final
            : null) ||
          null,
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
          // Extrai data SLA (estimated_delivery_limit) para classificação
          // today/upcoming de ready_to_ship. Campo pode ser string ou objeto
          // { date: "..." } dependendo da versão da API ML.
          const edl = j.shipping_option?.estimated_delivery_limit;
          const edf = j.shipping_option?.estimated_delivery_final;
          const slaRaw =
            (typeof edl === "string" ? edl : edl?.date) ||
            (typeof edf === "string" ? edf : edf?.date) ||
            null;
          return {
            id: String(sid),
            status: (j.status || "").toLowerCase(),
            substatus: (j.substatus || "none").toLowerCase(),
            dateShipped: j.status_history?.date_shipped || null,
            slaDate: slaRaw, // YYYY-MM-DDTHH:mm:ss... ou null
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

    const [pendingRaw, rtsRaw, shippedRaw, notDeliveredRaw] = await Promise.all([
      fetchAllOrdersByShippingStatus(token, sellerId, "pending", 5),
      fetchAllOrdersByShippingStatus(token, sellerId, "ready_to_ship", ML_LIVE_MAX_PAGES),
      fetchAllOrdersByShippingStatus(token, sellerId, "shipped", 10),
      fetchAllOrdersByShippingStatus(token, sellerId, "not_delivered", 3),
    ]);

    // ── FILTRAR + CLASSIFICAR PEDIDOS CANCELADOS ───────────────────────
    // ML UI: cancelled de HOJE → "Finalizadas" / cancelled antigo → ignora
    // Filtramos cancelled dos buckets operacionais e, se cancelado hoje,
    // adicionamos em "finalized".
    const isCancelled = (o) => o.status === "cancelled";
    const pendingOrders = pendingRaw.filter((o) => !isCancelled(o));
    const rtsOrders = rtsRaw.filter((o) => !isCancelled(o));
    const shippedOrders = shippedRaw.filter((o) => !isCancelled(o));
    const notDeliveredOrders = notDeliveredRaw.filter((o) => !isCancelled(o));

    // Cancelados/entregues/not_delivered de HOJE → Finalizadas.
    // Alinhado com ML Seller Center UI chip (que mostra só finalizações do dia).
    const cancelledOrdersSeen = new Set();
    const allRawOrders = [...pendingRaw, ...rtsRaw, ...shippedRaw, ...notDeliveredRaw];
    const cancelledRecent = [];
    for (const order of allRawOrders) {
      if (!isCancelled(order)) continue;
      const key = order.pack_id
        ? String(order.pack_id)
        : order.shipping?.id
          ? `s:${order.shipping.id}`
          : `o:${order.id}`;
      if (cancelledOrdersSeen.has(key)) continue;
      cancelledOrdersSeen.add(key);
      const cancelDate = order.date_closed || order.last_updated || order.date_created;
      const cancelKey = cancelDate ? getDateKey(cancelDate) : null;
      if (cancelKey === todayKey) {
        cancelledRecent.push(order);
      }
    }
    for (const order of cancelledRecent) {
      addMlOrderIds("finalized", [String(order.id)]);
    }

    // Busca adicional: cancelled de HOJE via order.status=cancelled
    // (ML remove do shipping.status ativo depois de algumas horas).
    try {
      const todayStartIso = todayKey + "T00:00:00.000-03:00";
      const cancelledR = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${sellerId}` +
          `&order.status=cancelled&order.date_closed.from=${encodeURIComponent(todayStartIso)}&limit=50&sort=date_desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }));
      const cancelledOrders = (cancelledR.results || []).filter((o) => o?.id);
      const cancelledPacks = deduplicateOrdersToPacks(cancelledOrders);
      for (const [key, pack] of cancelledPacks) {
        if (cancelledOrdersSeen.has(key)) continue;
        cancelledOrdersSeen.add(key);
        addMlOrderIds("finalized", pack.ml_order_ids);
      }
    } catch {
      // best-effort
    }

    // Busca adicional: delivered de HOJE (último dia).
    try {
      const todayStartIso = todayKey + "T00:00:00.000-03:00";
      const deliveredR = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${sellerId}` +
          `&shipping.status=delivered&order.date_last_updated.from=${encodeURIComponent(todayStartIso)}&limit=50&sort=date_desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] }));
      const deliveredOrders = (deliveredR.results || []).filter(
        (o) => o?.id && o.status !== "cancelled"
      );
      const deliveredPacks = deduplicateOrdersToPacks(deliveredOrders);
      for (const [, pack] of deliveredPacks) {
        addMlOrderIds("finalized", pack.ml_order_ids);
      }
    } catch {
      // best-effort
    }

    const cancelledFiltered = {
      pending: pendingRaw.length - pendingOrders.length,
      rts: rtsRaw.length - rtsOrders.length,
      shipped: shippedRaw.length - shippedOrders.length,
      nd: notDeliveredRaw.length - notDeliveredOrders.length,
      recent_finalized: cancelledRecent.length,
    };

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

    // Pending: ML Seller Center mantém TODOS em "Próximos dias" (observado
    // em múltiplas comparações). Alinhado com classifyCrossDockingOrder e
    // classifyFulfillmentOrder após commit e8f7787. Fix R1 do audit: antes
    // promovia pra today por SLA, inflando "Envios de hoje" em ~9 pedidos.
    for (const [, pack] of pendingPacks) {
      addMlOrderIds("upcoming", pack.ml_order_ids);
    }

    // Ready to ship → classificação por substatus + data SLA.
    // Replica a lógica de classifyCrossDockingOrder/classifyFulfillmentOrder
    // (classificação LOCAL que bate com ML Seller Center) mas usando dados
    // da API ML em vez do DB local.
    //
    // Regras alinhadas com ML Seller Center (data-based + substatus):
    // ML usa DATA SLA para decidir hoje vs próximos dias:
    //   - SLA (estimated_delivery_limit) ≤ HOJE → "Envios de hoje"
    //   - SLA > HOJE → "Próximos dias"
    // Exceções por substatus que SEMPRE vão pra "Próximos dias":
    //   - in_hub (no hub do transportador)
    //   - invoice_pending (aguardando NF-e)
    //   - ready_to_print (aguardando impressão)
    //   - in_warehouse (no armazém)
    //   - in_packing_list (na lista de separação)
    // Exceções por substatus que SEMPRE vão pra "Envios de hoje":
    //   - ready_for_pickup (pronto para coleta HOJE)
    //   - packed (empacotado para envio)
    //   - ready_to_pack (pronto para empacotar)
    // Excluídos (transição):
    //   - picked_up, authorized_by_carrier
    let rtsNoShipment = 0, rtsStatusMismatch = 0;
    for (const [, pack] of rtsPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      if (!shipment) {
        rtsNoShipment++;
        addMlOrderIds("upcoming", pack.ml_order_ids);
        continue;
      }
      if (shipment.status !== "ready_to_ship") {
        rtsStatusMismatch++;
        continue;
      }
      const sub = shipment.substatus;
      if (RTS_EXCLUDED_SUBSTATUSES.has(sub)) {
        continue;
      }

      // ALINHAMENTO ML (4a auditoria via screenshots 2026-04-23):
      // detecta se eh Full vs cross-docking pra aplicar regras corretas.
      const isFull =
        shipment.logisticType === "fulfillment" ||
        (pack.deposit_key && String(pack.deposit_key).startsWith("node:"));

      // today — prontos pra envio/coleta (ambos cross e full)
      if (
        sub === "ready_for_pickup" ||
        sub === "packed" ||
        sub === "ready_to_pack"
      ) {
        addMlOrderIds("today", pack.ml_order_ids);
        continue;
      }

      // invoice_pending → upcoming (aguarda NF-e)
      if (sub === "invoice_pending") {
        addMlOrderIds("upcoming", pack.ml_order_ids);
        continue;
      }

      // in_hub (cross OU full): CARD_IN_THE_WAY no ML → in_transit
      // (pacote JA saiu, esta com carrier)
      if (sub === "in_hub") {
        addMlOrderIds("in_transit", pack.ml_order_ids);
        continue;
      }

      // in_packing_list: depende da logistica
      // - cross-docking: CARD_IN_THE_WAY "A caminho" → in_transit
      // - full: CARD_FULL "Processando CD" → today
      if (sub === "in_packing_list") {
        addMlOrderIds(isFull ? "today" : "in_transit", pack.ml_order_ids);
        continue;
      }

      // in_warehouse: so acontece em Full (pacote no warehouse ML)
      // ML mostra CARD_FULL "Processando CD" / "Vamos enviar dia X" → today
      if (sub === "in_warehouse") {
        addMlOrderIds(isFull ? "today" : "upcoming", pack.ml_order_ids);
        continue;
      }

      // ready_to_print → today (precisa imprimir antes da coleta)
      if (sub === "ready_to_print") {
        addMlOrderIds("today", pack.ml_order_ids);
        continue;
      }

      // Substatuses desconhecidos: usa SLA
      const slaKey = shipment.slaDate ? getSlaDateKey(shipment.slaDate) : null;
      if (slaKey && slaKey > todayKey) {
        addMlOrderIds("upcoming", pack.ml_order_ids);
      } else if (slaKey) {
        addMlOrderIds("today", pack.ml_order_ids);
      } else {
        addMlOrderIds("upcoming", pack.ml_order_ids);
      }
    }

    // Shipped → classificação restritiva (alinhada com ML Seller Center).
    //
    // ML Seller Center NÃO mostra envios normais em trânsito nos chips.
    // Apenas pedidos com PROBLEMAS de entrega aparecem em "Em trânsito":
    //   - out_for_delivery, receiver_absent, not_visited, at_customs
    //   - E somente se enviados nos últimos 2 dias (evita stale)
    //
    // waiting_for_withdrawal (ponto de retirada) → "Próximos dias"
    // Todos os outros shipped → excluídos dos chips (trânsito normal,
    // nenhuma ação necessária do vendedor).
    //
    // A classificação anterior (TODOS shipped → in_transit) inflava o chip
    // de 3 (ML real) para 190 (nosso). Agora replica a lógica LOCAL de
    // classifyCrossDockingOrder (lines 549-558) que já bate com ML.
    const nowMs = Date.now();
    const msPerDay = 86400000;
    let shippedNoDate = 0, shippedStale = 0, shippedNormal = 0;
    for (const [, pack] of shippedPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      if (!shipment) continue;
      if (shipment.status !== "shipped") continue;
      const sub = shipment.substatus;
      // ALINHAMENTO ML (4a auditoria): waiting_for_withdrawal → in_transit
      // (CARD_WAITING_FOR_WITHDRAWAL vive em TAB_IN_THE_WAY do ML)
      if (sub === "waiting_for_withdrawal") {
        addMlOrderIds("in_transit", pack.ml_order_ids);
      } else if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(sub)) {
        // AJUSTE FINO (2026-04-23 tarde): gate de 3 dias pra aproximar do
        // chip do ML (antes era 7 → inflou in_transit pra 135 vs chip=6).
        if (!shipment.dateShipped) { shippedNoDate++; continue; }
        const shippedAt = new Date(shipment.dateShipped).getTime();
        if (Number.isNaN(shippedAt)) { shippedNoDate++; continue; }
        const ageDays = (nowMs - shippedAt) / msPerDay;
        if (ageDays <= 3) {
          addMlOrderIds("in_transit", pack.ml_order_ids);
        } else {
          shippedStale++;
        }
      } else if (!sub && shipment.dateShipped) {
        // AJUSTE FINO: shipped sem substatus → in_transit so se shipped nas
        // ultimas 72h. ML chip usa janela curta similar.
        const shippedAt = new Date(shipment.dateShipped).getTime();
        if (!Number.isNaN(shippedAt) && (nowMs - shippedAt) / msPerDay <= 3) {
          addMlOrderIds("in_transit", pack.ml_order_ids);
        } else {
          shippedStale++;
        }
      } else {
        // Trânsito normal (in_transit, at_sender, etc.) → nenhum chip.
        // ML Seller Center não mostra envios normais nas abas.
        shippedNormal++;
      }
    }

    // Not delivered → TODOS vão para "Finalizadas" (match com ML Seller Center).
    // No ML Seller Center, pedidos com entrega falha (devoluções, perdidos, etc.)
    // aparecem em "Gerenciar Pós-venda" e "Finalizadas", NUNCA em "Em trânsito".
    // A lógica anterior colocava returning_to_sender/delayed/etc em in_transit,
    // inflando o chip. A classificação LOCAL (classifyCrossDockingOrder line 568)
    // já coloca TODOS not_delivered em "finalized" e bate com ML.
    const ndSubstatusBreakdown = {};
    for (const [, pack] of ndPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      const ndSub = shipment?.substatus || "unknown";
      ndSubstatusBreakdown[ndSub] = (ndSubstatusBreakdown[ndSub] || 0) + 1;
    }

    // Finalizadas: not_delivered de HOJE (alinhado com janela do bucket).
    try {
      const todayStartIso = todayKey + "T00:00:00.000-03:00";
      const ndR = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${sellerId}` +
          `&shipping.status=not_delivered&order.date_last_updated.from=${todayStartIso}&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.json()).catch(() => ({ results: [] }));
      const ndToday = (ndR.results || []).filter((o) => o?.id && o.status !== "cancelled");
      const ndTodayPacks = deduplicateOrdersToPacks(ndToday);
      for (const [, pack] of ndTodayPacks) {
        addMlOrderIds("finalized", pack.ml_order_ids);
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

    // ═════════════════════════════════════════════════════════════════
    // ML CHIP PROXY (opcional, desativado por default):
    //
    // O endpoint oficial do ML (/sales-omni/packs/marketshops/
    // operations-dashboard/tabs) retorna chips 1:1 com o Seller Center,
    // MAS descobrimos que o valor de TAB_TODAY no retorno depende do
    // parametro `filters` enviado na query — nao e estavel. Alem disso
    // depende de storage state do ML (expira ~horas), gerando 403
    // quando a sessao cai.
    //
    // Pra ativar: setar env ENABLE_ML_CHIP_PROXY=true. Quando ativo,
    // tenta buscar counts oficiais; se falhar, fallback pra local.
    // Default: usa classifier local (semanticamente correto, conforme
    // 4a auditoria, ~96% de concordancia com chip do ML).
    //
    // Ver docs/ml-chip-sync-notes.md pra historico completo.
    // ═════════════════════════════════════════════════════════════════
    result.chip_source = "local_classifier";
    if (process.env.ENABLE_ML_CHIP_PROXY === "true") {
      try {
        const mlCounts = await fetchMLChipCountsDirect();
        if (mlCounts && typeof mlCounts === "object") {
          result.counts_local = { ...result.counts };
          result.counts.today = mlCounts.today;
          result.counts.upcoming = mlCounts.upcoming;
          result.counts.in_transit = mlCounts.in_transit;
          result.counts.finalized = mlCounts.finalized;
          result.chip_source = "ml_direct";
        }
      } catch {
        // fail-open — fallback pra local
      }
    }

    // ── Diagnóstico detalhado ─────────────────────────────────────────
    // Log completo da classificação com breakdown de substatuses para
    // validar contra ML Seller Center. Mostra cada substatus encontrado
    // e como foi classificado, permitindo identificar divergências.
    const rtsSubBreakdown = {};
    for (const [, pack] of rtsPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      const sub = shipment ? `${shipment.status}/${shipment.substatus}` : "no_shipment";
      rtsSubBreakdown[sub] = (rtsSubBreakdown[sub] || 0) + 1;
    }
    const shippedSubBreakdown = {};
    for (const [, pack] of shippedPacks) {
      const shipment = shipmentMap.get(String(pack.shipping_id));
      const sub = shipment ? `${shipment.status}/${shipment.substatus}` : "no_shipment";
      shippedSubBreakdown[sub] = (shippedSubBreakdown[sub] || 0) + 1;
    }
    // Log de diagnóstico — apenas quando DEBUG_ML_CHIPS=true pra não
    // poluir o console em produção (executa a cada 30s).
    if (process.env.DEBUG_ML_CHIPS === "true") {
      console.log(
        `[ML Live Chips] seller=${sellerId}` +
          ` | raw_fetched: pending=${pendingRaw.length} rts=${rtsRaw.length}` +
          ` shipped=${shippedRaw.length} nd=${notDeliveredRaw.length}` +
          ` | RESULT: today=${result.counts.today} upcoming=${result.counts.upcoming}` +
          ` in_transit=${result.counts.in_transit} finalized=${result.counts.finalized}` +
          ` cancelled=${result.counts.cancelled}`
      );
    }

    // ML nao coleta em sab/dom/feriado nacional. Move IDs de today → upcoming
    // nos dias sem coleta, antes de retornar. Aplicado AQUI no fim pra nao
    // tocar em cada ramo da classificacao interna (que sao muitos).
    // buckets e result.order_ids_by_bucket sao a mesma referencia — basta
    // mutar buckets e atualizar counts.
    if (!isBrazilianBusinessDay(todayKey)) {
      for (const id of buckets.today) {
        buckets.upcoming.add(id);
      }
      buckets.today.clear();
      result.counts.today = 0;
      result.counts.upcoming = buckets.upcoming.size;
    }

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
  const allOrders = fetchStoredOrders(baseConnection.id);

  // Filtro de freshness: remove pedidos com status operacional provavelmente
  // desatualizado ("stale"). Quando o sync não re-busca pedidos antigos,
  // eles ficam presos em status transitórios (paid, shipped) mesmo que já
  // tenham sido entregues/cancelados. O ML Seller Center os remove automaticamente.
  //
  // Regras de freshness (baseadas no ciclo de vida típico do ML):
  //   - "paid"/"pending"/"confirmed": stale depois de 14 dias
  //   - "ready_to_ship": stale depois de 30 dias
  // Thresholds para detectar dados stale no dashboard. Usa data de referência
  // contextual: date_shipped para shipped/in_transit, date_cancelled para cancelled.
  // Entrega ML = 2-3 dias. Thresholds agressivos para eliminar pedidos fantasma
  // que ficam presos em status transitórios no DB local.
  const STALE_THRESHOLDS_DAYS = {
    paid: 7,
    pending: 7,
    confirmed: 7,
    handling: 7,
    ready_to_ship: 21,
    shipped: 3,       // ML entrega em 2-3 dias; 3d elimina fantasmas "shipped" já entregues
    in_transit: 2,    // Alinhado com ML live chips (age ≤ 2d para shipped_in_transit_substatuses)
    not_delivered: 5,  // Reduzido de 10 para alinhar com ML Seller Center
    cancelled: 3,     // Cancelamentos recentes apenas — ML não mostra cancelados nos chips
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

    // Status finais sem threshold (delivered, returned, etc.) ou desconhecidos: sem filtro
    if (thresholdDays == null) return true;

    // Data de referência: depende do status para ser mais preciso
    let referenceDate = saleDate;
    if (shipmentStatus === "shipped" || shipmentStatus === "in_transit") {
      // Usa data de envio (não data de venda) — mais preciso para detectar stale
      const statusHistory = snapshot.status_history || {};
      const shippedDate = statusHistory.date_shipped ? new Date(statusHistory.date_shipped) : null;
      if (shippedDate && !isNaN(shippedDate.getTime())) {
        referenceDate = shippedDate;
      }
    } else if (shipmentStatus === "cancelled") {
      // Usa data de cancelamento — só mostra cancelamentos recentes
      const statusHistory = snapshot.status_history || {};
      const cancelledDate = statusHistory.date_cancelled ? new Date(statusHistory.date_cancelled) : null;
      if (cancelledDate && !isNaN(cancelledDate.getTime())) {
        referenceDate = cancelledDate;
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

      let bucket =
        depositInfo.logisticType === "fulfillment"
          ? classifyFulfillmentOrder(order, todayKey, null)
          : classifyCrossDockingOrder(order, todayKey);

      // ML nao coleta em sab/dom/feriado nacional. Nesses dias o bucket
      // "Envios de hoje" fica vazio — pedidos que iriam pra today ficam
      // em upcoming ate o proximo dia util.
      if (bucket === "today" && !isBrazilianBusinessDay(todayKey)) {
        bucket = "upcoming";
      }

      // Finalizadas: mostra APENAS finalizações de HOJE (alinhado com ML UI).
      // Observação real: ML chip "Finalizadas" mostra 10 enquanto tabela
      // do último mês tem 1200+. O chip é restrito ao dia atual.
      // Antes usávamos 7 dias → app inflava pra 73 vs ML 10.
      if (bucket === "finalized") {
        const snapshot = getShipmentSnapshot(order);
        const statusHistory = snapshot.status_history || {};
        const exceptionDateKey =
          getDateKey(statusHistory.date_cancelled) ||
          getDateKey(statusHistory.date_not_delivered) ||
          getDateKey(statusHistory.date_returned) ||
          getDateKey(statusHistory.date_delivered) ||
          getDateKey(order.sale_date);
        if (!exceptionDateKey || exceptionDateKey !== todayKey) {
          continue; // Só conta finalizações do dia atual
        }
      }

      // Canceladas: mesma janela (só hoje) alinhada com ML UI.
      if (bucket === "cancelled") {
        const snapshot = getShipmentSnapshot(order);
        const statusHistory = snapshot.status_history || {};
        const cancelDateKey =
          getDateKey(statusHistory.date_cancelled) || getDateKey(order.sale_date);
        if (!cancelDateKey || cancelDateKey !== todayKey) {
          continue;
        }
      }

      if (!bucket || !OPERATIONAL_BUCKETS.includes(bucket)) {
        // Keep walking. Native ML buckets are computed separately.
      } else {
        // Dedup global por bucket — o mesmo envio não pode ser contado 2x.
        // Fallback pack_id → shipping_id → order_id para que pedidos SEM
        // pack_id mas com múltiplos items (cada item é 1 row no DB) contem
        // como 1 só. Sem esse fallback, pedido com 3 items incrementa 3x.
        // Alinhado com padrão já usado em outras partes do código (linha 1471).
        const packId = order.raw_data?.pack_id ? String(order.raw_data.pack_id) : null;
        const shippingId = order.shipping_id ? String(order.shipping_id) : null;
        const mlOrderId = order.order_id ? String(order.order_id) : null;
        const dedupeId = packId || shippingId || mlOrderId;
        const dedupeKey = dedupeId ? `${bucket}:${dedupeId}` : null;
        const isAlreadyCounted = dedupeKey && countedPacks.has(dedupeKey);

        // Always track order IDs (for grid display).
        // ⚠️ order.id aqui é DB row id (fetchStoredOrders), NÃO ML order id.
        deposit.order_ids_by_bucket[bucket].push(order.id);
        deposit.native_order_ids_by_bucket[bucket].push(order.id);

        // Só incrementa count 1x por envio (pack/shipping/order)
        if (!isAlreadyCounted) {
          deposit.counts[bucket] += 1;
          deposit.native_counts[bucket] += 1;
          if (dedupeKey) countedPacks.add(dedupeKey);
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
  let mlBucketByMlOrderId = null; // ml_order_id → bucket (pra override)
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

      // Mapa ml_order_id → bucket pra override direto (sem tradução).
      // Cada pedido no deposit._orders tem order.order_id = ML order id.
      mlBucketByMlOrderId = new Map();
      for (const bucket of Object.keys(mergedIds)) {
        for (const mlOrderId of mergedIds[bucket]) {
          mlBucketByMlOrderId.set(String(mlOrderId), bucket);
        }
      }

      // ── TRADUÇÃO DE IDs pro frontend ─────────────────────────────
      // Map ML order_id → DB row ids. Pedidos multi-item têm múltiplos
      // DB row ids pro mesmo ML order_id — incluímos todos.
      const mlOrderIdToDbIds = new Map();
      for (const order of allOrders) {
        if (!order.order_id) continue;
        const key = String(order.order_id);
        if (!mlOrderIdToDbIds.has(key)) mlOrderIdToDbIds.set(key, []);
        mlOrderIdToDbIds.get(key).push(String(order.id));
      }

      const translateIds = (idSet) => {
        const out = [];
        for (const mlId of idSet) {
          const dbIds = mlOrderIdToDbIds.get(String(mlId));
          if (!dbIds) continue;
          for (const dbId of dbIds) out.push(dbId);
        }
        return out;
      };

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
    mlBucketByMlOrderId = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ML AUTHORITATIVE OVERRIDE
  // Se temos a classificação LIVE do ML (ml_live_chip_order_ids_by_bucket),
  // SOBRESCREVEMOS os counts e order_ids de cada depósito pra usar
  // exatamente o que o ML diz — eliminando TODO drift de classificação
  // interna. O app fica 1:1 com ML Seller Center.
  //
  // Pedidos que o ML NÃO retorna em nenhum bucket são excluídos dos
  // contadores (provavelmente são históricos que ML removeu da visão
  // operacional). Pedidos do ML que não estão no DB ainda ficam de fora
  // do grid mas contam no chip (via ml_live_chip_counts global).
  //
  // ⚠️ IMPORTANTE: itera `allOrders` (não `deposit._orders`), porque
  // `_orders` só contém pedidos que passaram pelo filtro de freshness
  // (STALE_THRESHOLDS_DAYS). Pedidos que o ML considera ativos mas o
  // app marcou como stale eram perdidos pelo override — gerava
  // PERSISTENT_CLASSIFICATION_LOGIC_BUG nos logs com ~230 pedidos
  // "missing". Usando `allOrders`, o override consegue recuperar TODOS
  // os pedidos que o ML atualmente classifica, independente do status
  // local. O filtro de freshness continua útil pra limpar a listagem
  // quando NÃO há override (fallback).
  // ═══════════════════════════════════════════════════════════════════
  if (mlBucketByMlOrderId && mlBucketByMlOrderId.size > 0) {
    const makeEmptyCounts = () => ({
      today: 0,
      upcoming: 0,
      in_transit: 0,
      finalized: 0,
      cancelled: 0,
    });
    const makeEmptyLists = () => ({
      today: [],
      upcoming: [],
      in_transit: [],
      finalized: [],
      cancelled: [],
    });

    // Agrupa TODOS os orders ativos (pré-freshness) por depósito, pra
    // garantir que o override veja pedidos que o ML ainda considera
    // ativos mesmo quando localmente eles foram marcados como stale.
    // Só considera depósitos que já existem em `deposits` (criados pelo
    // loop principal com pelo menos 1 order fresh). Pedidos de depósitos
    // 100% stale caem no `ml_live_chip_counts` global sem aparecer no
    // breakdown por depósito — trade-off aceitável (raro na prática).
    const allOrdersByDepositKey = new Map();
    for (const order of allOrders) {
      const depositInfo = getDepositInfo(order);
      if (!allOrdersByDepositKey.has(depositInfo.key)) {
        allOrdersByDepositKey.set(depositInfo.key, []);
      }
      allOrdersByDepositKey.get(depositInfo.key).push(order);
    }

    for (const deposit of deposits) {
      const newCounts = makeEmptyCounts();
      const newOrderIds = makeEmptyLists();
      const dedupeInBucket = new Set();

      const ordersForDeposit = allOrdersByDepositKey.get(deposit.key) || [];
      for (const order of ordersForDeposit) {
        // Busca por ML order_id (mesmo pra todos os items do pedido —
        // garante que pedidos multi-item batem corretamente).
        const mlBucket = order.order_id
          ? mlBucketByMlOrderId.get(String(order.order_id))
          : null;
        if (!mlBucket || !OPERATIONAL_BUCKETS.includes(mlBucket)) continue;

        // Dedup por pack/shipping/order (evita multi-items contarem 2x).
        const packId = order.raw_data?.pack_id
          ? String(order.raw_data.pack_id)
          : null;
        const shippingId = order.shipping_id ? String(order.shipping_id) : null;
        const mlOrderId = order.order_id ? String(order.order_id) : null;
        const dedupeId = packId || shippingId || mlOrderId;
        const dedupeKey = dedupeId ? `${mlBucket}:${dedupeId}` : null;

        newOrderIds[mlBucket].push(order.id);
        if (!dedupeKey || !dedupeInBucket.has(dedupeKey)) {
          newCounts[mlBucket] += 1;
          if (dedupeKey) dedupeInBucket.add(dedupeKey);
        }
      }

      deposit.counts = newCounts;
      deposit.internal_operational_counts = newCounts;
      deposit.order_ids_by_bucket = newOrderIds;
      deposit.internal_operational_order_ids_by_bucket = newOrderIds;
      deposit.total_count = Object.values(newCounts).reduce((s, n) => s + n, 0);
      deposit.internal_operational_total_count = deposit.total_count;
    }
  }

  // ML UI chip counts (via scraper do Seller Center — 100% alinhado com UI).
  // Override com maior prioridade se disponível.
  let mlUiChipCounts = null;
  try {
    const { getUiChipCounts } = await import("./_lib/seller-center-scraper.js");
    mlUiChipCounts = getUiChipCounts();
  } catch {
    // scraper não configurado ou falhou — ignora (fallback pro ml_live_chip_counts)
  }

  const payload = {
    backend_secure: true,
    generated_at: new Date().toISOString(),
    internal_operational: buildInternalOperationalLayerMetadata(),
    seller_center_mirror: sellerCenterMirrorOverview,
    post_sale_overview: postSaleOverview,
    operational_queues: operationalQueues,
    deposits,
    // Contagens da UI do ML Seller Center (scraper headless).
    // Fonte de verdade MÁXIMA — bate 100% com o que o usuário vê no ML.
    // Se null, o frontend usa ml_live_chip_counts (fallback API ML).
    ml_ui_chip_counts: mlUiChipCounts,
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
  classifyFulfillmentOrder,
  classifyNativeMercadoLivreOrder,
  classifySellerCenterMirrorEntity,
  isSellerCenterMirrorFinalStatus,
  isOrderForCollection,
  isOrderUnderReview,
};
