import { getLatestConnection, getOrderSummariesByScope } from "./_lib/storage.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  getMirrorEntityStatusBreakdown,
  getSellerCenterMirrorOverview,
} from "./_lib/mirror-storage.js";
import { listNfeDocumentsBySellerId } from "../nfe/_lib/nfe-storage.js";
import {
  getLatestPrivateSellerCenterSnapshotsByStoreAndTab,
  getPrivateSellerCenterSnapshotStatus,
} from "./_lib/private-seller-center-storage.js";
import { buildPrivateSellerCenterPostSaleAudit } from "./_lib/private-seller-center-audit.js";

const OPEN_STATUSES = new Set(["pending", "handling", "ready_to_ship", "confirmed", "paid"]);
const TRANSIT_STATUSES = new Set(["shipped", "in_transit"]);
const FINAL_EXCEPTION_STATUSES = new Set(["cancelled", "not_delivered", "returned"]);
const OPERATIONAL_BUCKETS = ["today", "upcoming", "in_transit", "finalized"];
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
const DASHBOARD_CACHE_TTL_MS = 15 * 1000; // 15 segundos — refresh mais agressivo para operação
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

function fetchStoredOrders(limit = null) {
  if (limit != null) {
    return getOrderSummariesByScope("operational").slice(0, Math.max(0, Number(limit) || 0));
  }

  return getOrderSummariesByScope("operational");
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

function isOrderReadyToPrintLabel(order) {
  return (
    isOrderReadyForInvoiceLabel(order) &&
    normalizeState(getShipmentSnapshot(order).substatus) !== "invoice_pending"
  );
}

function isOrderInvoicePending(order) {
  return (
    isOrderReadyForInvoiceLabel(order) &&
    normalizeState(getShipmentSnapshot(order).substatus) === "invoice_pending"
  );
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

  // O ML Seller Center só mostra pedidos acionáveis pelo vendedor.
  // Pedidos paid/pending/confirmed NÃO aparecem no painel operacional
  // porque o ML ainda não atribuiu logística. Apenas "ready_to_ship"
  // e "handling" são operacionais para o vendedor.
  if (status === "ready_to_ship" || status === "handling") {
    // Pedido retirado pelo transportador — em trânsito
    if (CROSS_DOCKING_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }

    // Em preparação ou no hub — próximos dias
    if (CROSS_DOCKING_UPCOMING_SUBSTATUSES.has(substatus)) {
      return "upcoming";
    }

    // Pronto para coleta — envios de hoje
    if (substatus === "ready_for_pickup") {
      return "today";
    }

    // Empacotado: pronto para envio. Usa SLA para decidir hoje/próximos.
    // ML Seller Center coloca "packed" em "Envios de hoje" somente se SLA é hoje.
    if (substatus === "packed") {
      if (dates.operationalDueDateKey) {
        return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
          ? "today"
          : "upcoming";
      }
      return "today";
    }

    // invoice_pending e outros substatuses: usar SLA para classificar.
    // ML mostra esses em "Próximos dias" quando SLA é futuro.
    if (dates.operationalDueDateKey) {
      return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey) ? "today" : "upcoming";
    }

    return "upcoming";
  }

  // "shipped" com tracking ativo (carrier escaneou) = em trânsito.
  // "shipped/none": enviado mas sem scan do carrier. ML coloca em "Próximos dias",
  // não em "Em trânsito". Se enviado hoje → "upcoming". Senão → exclui (provavelmente
  // já foi entregue, sync incremental não pegou a atualização).
  if (status === "shipped") {
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }
    if (substatus === "none" || substatus === "waiting_for_withdrawal" || substatus === "claimed_me") {
      if (dates.shippedDateKey && isSameCalendarDay(dates.shippedDateKey, todayKey)) {
        return "upcoming";
      }
      return null;
    }
    return null;
  }

  // "in_transit" como status direto = definitivamente em trânsito
  if (status === "in_transit") {
    return "in_transit";
  }

  // not_delivered: verificar substatus — alguns são logística ativa (em trânsito),
  // outros são finalizados (devolvido, perdido).
  if (status === "not_delivered") {
    if (NOT_DELIVERED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }
    return "finalized";
  }

  // Finalizadas: cancelled, returned
  if (status === "cancelled" || status === "returned") {
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

  // Fulfillment: apenas ready_to_ship e handling são operacionais.
  // paid/pending/confirmed → ML está processando, vendedor não tem ação.
  if (status === "ready_to_ship" || status === "handling") {
    // "ready_to_pack" = ML está ativamente preparando o pedido → sempre "hoje"
    if (substatus === "ready_to_pack") {
      return "today";
    }

    // "packed" = ML já empacotou. Usa SLA.
    if (substatus === "packed") {
      if (dates.operationalDueDateKey) {
        return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey)
          ? "today"
          : "upcoming";
      }
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

  // Fulfillment: mesma lógica de shipped — só tracking real = in_transit.
  if (status === "shipped") {
    if (SHIPPED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }
    if (substatus === "none" || substatus === "waiting_for_withdrawal" || substatus === "claimed_me") {
      if (dates.shippedDateKey && isSameCalendarDay(dates.shippedDateKey, todayKey)) {
        return "upcoming";
      }
      return null;
    }
    return null;
  }

  if (status === "in_transit") {
    return "in_transit";
  }

  // not_delivered: verificar substatus
  if (status === "not_delivered") {
    if (NOT_DELIVERED_IN_TRANSIT_SUBSTATUSES.has(substatus)) {
      return "in_transit";
    }
    return "finalized";
  }

  if (status === "cancelled" || status === "returned") {
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
  };
}

function cloneBucketCounts(source = {}) {
  return {
    today: Number(source.today || 0),
    upcoming: Number(source.upcoming || 0),
    in_transit: Number(source.in_transit || 0),
    finalized: Number(source.finalized || 0),
  };
}

function buildEmptyBucketOrderIds() {
  return {
    today: [],
    upcoming: [],
    in_transit: [],
    finalized: [],
  };
}

function cloneBucketOrderIds(source = {}) {
  return {
    today: Array.isArray(source.today) ? [...source.today] : [],
    upcoming: Array.isArray(source.upcoming) ? [...source.upcoming] : [],
    in_transit: Array.isArray(source.in_transit) ? [...source.in_transit] : [],
    finalized: Array.isArray(source.finalized) ? [...source.finalized] : [],
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
  const STALE_THRESHOLDS_DAYS = {
    paid: 14,
    pending: 14,
    confirmed: 14,
    handling: 14,
    ready_to_ship: 30,
    shipped: 7,
    in_transit: 7,
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
      // Usa a DATA DA EXCEÇÃO (date_cancelled, date_not_delivered, date_returned),
      // não a data de venda, para alinhar com o ML Seller Center que mostra
      // apenas as finalizações dos últimos ~2 dias.
      if (bucket === "finalized") {
        const snapshot = getShipmentSnapshot(order);
        const statusHistory = snapshot.status_history || {};
        const exceptionDate =
          parseDate(statusHistory.date_cancelled) ||
          parseDate(statusHistory.date_not_delivered) ||
          parseDate(statusHistory.date_returned) ||
          (order.sale_date ? new Date(order.sale_date) : null);
        const ageDays = exceptionDate
          ? (today.getTime() - exceptionDate.getTime()) / (24 * 60 * 60 * 1000)
          : 999;
        if (ageDays > 2) {
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

        // Always track order IDs (for grid display)
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
  const payload = {
    backend_secure: true,
    generated_at: new Date().toISOString(),
    internal_operational: buildInternalOperationalLayerMetadata(),
    seller_center_mirror: sellerCenterMirrorOverview,
    post_sale_overview: postSaleOverview,
    operational_queues: operationalQueues,
    deposits,
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
