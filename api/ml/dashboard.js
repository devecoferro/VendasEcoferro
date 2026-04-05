import { getLatestConnection, getOrders } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { consolidateOrders } from "./orders.js";

const OPEN_STATUSES = new Set(["pending", "handling", "ready_to_ship"]);
const TRANSIT_STATUSES = new Set(["shipped", "in_transit"]);
const FINAL_EXCEPTION_STATUSES = new Set(["cancelled", "not_delivered", "returned"]);
const OPERATIONAL_BUCKETS = ["today", "upcoming", "in_transit", "finalized"];
const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";
const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeState(value, fallback = "none") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized || fallback;
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
  const label =
    typeof depositSnapshot.label === "string" && depositSnapshot.label.trim()
      ? depositSnapshot.label.trim()
      : "Vendas sem deposito";

  return {
    key: String(depositSnapshot.key || "without-deposit"),
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

  return depositInfo.logisticType === "fulfillment"
    ? depositInfo.label === "Vendas sem deposito"
      ? "Full"
      : depositInfo.label
    : `Coleta | ${depositInfo.label}`;
}

function fetchStoredOrders(limit = 1000) {
  return consolidateOrders(getOrders(limit));
}

async function fetchItemInventoryId(accessToken, itemId, cache) {
  if (!itemId) return null;
  if (cache.has(itemId)) return cache.get(itemId) ?? null;

  try {
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      cache.set(itemId, null);
      return null;
    }

    const payload = await response.json();
    const inventoryId =
      typeof payload.inventory_id === "string" && payload.inventory_id.trim()
        ? payload.inventory_id.trim()
        : null;

    cache.set(itemId, inventoryId);
    return inventoryId;
  } catch {
    cache.set(itemId, null);
    return null;
  }
}

function findShipmentReference(operation) {
  const references = Array.isArray(operation?.external_references)
    ? operation.external_references
    : [];

  const shipmentRef = references.find((reference) => reference?.type === "shipment_id");
  return shipmentRef?.value ? String(shipmentRef.value) : null;
}

async function fetchFulfillmentOperationsByOrder(connection, orders) {
  const relevantOrders = orders.filter((order) => {
    const { logisticType } = getDepositInfo(order);
    if (logisticType !== "fulfillment") return false;

    const { status, substatus } = getShipmentStatus(order);
    if (OPEN_STATUSES.has(status)) return true;
    if (TRANSIT_STATUSES.has(status) && substatus !== "none") return true;
    if (FINAL_EXCEPTION_STATUSES.has(status)) return true;
    return false;
  });

  if (relevantOrders.length === 0) {
    return new Map();
  }

  const inventoryIdCache = new Map();
  const operationsByOrderId = new Map();

  for (const order of relevantOrders) {
    const shipmentSnapshot = getShipmentSnapshot(order);
    const shipmentId =
      shipmentSnapshot.id || getRawData(order).shipping_id || getRawData(order).shipping?.id;
    const representativeItemId =
      order.item_id || order.items?.find((item) => item.item_id)?.item_id || null;
    const inventoryId = await fetchItemInventoryId(
      connection.access_token,
      representativeItemId,
      inventoryIdCache
    );

    if (!inventoryId || !shipmentId) {
      continue;
    }

    const url =
      `https://api.mercadolibre.com/stock/fulfillment/operations/search?` +
      `seller_id=${encodeURIComponent(connection.seller_id)}` +
      `&inventory_id=${encodeURIComponent(inventoryId)}` +
      `&external_references.shipment_id=${encodeURIComponent(String(shipmentId))}` +
      `&limit=1`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const firstOperation = Array.isArray(payload.results) ? payload.results[0] || null : null;
      if (!firstOperation) {
        continue;
      }

      operationsByOrderId.set(order.id, {
        inventoryId,
        type: firstOperation.type || null,
        dateCreated: parseDate(firstOperation.date_created),
        shipmentId: findShipmentReference(firstOperation),
      });
    } catch {
      // Ignore fulfillment enrichment failures so the dashboard can still render.
    }
  }

  return operationsByOrderId;
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

  if (OPEN_STATUSES.has(status)) {
    if (dates.operationalDueDateKey) {
      return isSameOrPastCalendarDay(dates.operationalDueDateKey, todayKey) ? "today" : "upcoming";
    }

    if (status === "ready_to_ship" && ["picked_up", "ready_for_pickup"].includes(substatus)) {
      return "today";
    }

    return "upcoming";
  }

  if (TRANSIT_STATUSES.has(status)) {
    if (substatus !== "none" && isSameCalendarDay(dates.shippedDateKey, todayKey)) {
      return "in_transit";
    }

    return null;
  }

  if (FINAL_EXCEPTION_STATUSES.has(status)) {
    if (isSameCalendarDay(dates.finalExceptionDateKey, todayKey)) {
      return "finalized";
    }

    return null;
  }

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

  if (OPEN_STATUSES.has(status)) {
    if (["in_warehouse", "ready_to_pack"].includes(substatus)) {
      return "today";
    }

    if (isSameCalendarDay(operationDateKey, todayKey)) {
      return "today";
    }

    return "upcoming";
  }

  if (TRANSIT_STATUSES.has(status)) {
    if (substatus !== "none" && isSameCalendarDay(dates.shippedDateKey, todayKey)) {
      return "in_transit";
    }

    return null;
  }

  if (FINAL_EXCEPTION_STATUSES.has(status)) {
    if (isSameCalendarDay(dates.finalExceptionDateKey, todayKey)) {
      return "finalized";
    }

    return null;
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
    counts: {
      today: 0,
      upcoming: 0,
      in_transit: 0,
      finalized: 0,
    },
    order_ids_by_bucket: {
      today: [],
      upcoming: [],
      in_transit: [],
      finalized: [],
    },
    operational_source:
      info.logisticType === "fulfillment"
        ? "shipment_snapshot+fulfillment_operations"
        : "shipment_sla+shipment_snapshot",
    total_count: 0,
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

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const baseConnection = getLatestConnection();
    const orders = fetchStoredOrders(1000);

    if (!baseConnection?.id) {
      return response.status(200).json({
        backend_secure: true,
        generated_at: new Date().toISOString(),
        deposits: [],
      });
    }

    const connection = await ensureValidAccessToken(baseConnection);
    const today = new Date();
    const todayKey = getCalendarKey(today);
    const fulfillmentOperationsByOrderId = await fetchFulfillmentOperationsByOrder(connection, orders);
    const depositsMap = new Map();

    for (const order of orders) {
      const depositInfo = getDepositInfo(order);
      if (!depositsMap.has(depositInfo.key)) {
        depositsMap.set(depositInfo.key, buildEmptyDepositEntry(depositInfo));
      }

      const deposit = depositsMap.get(depositInfo.key);
      deposit._orders.push(order);

      const fulfillmentOperation = fulfillmentOperationsByOrderId.get(order.id) || null;
      const bucket =
        depositInfo.logisticType === "fulfillment"
          ? classifyFulfillmentOrder(order, todayKey, fulfillmentOperation)
          : classifyCrossDockingOrder(order, todayKey);

      if (!bucket || !OPERATIONAL_BUCKETS.includes(bucket)) {
        continue;
      }

      deposit.counts[bucket] += 1;
      deposit.order_ids_by_bucket[bucket].push(order.id);
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

        return {
          key: deposit.key,
          label: deposit.label,
          logistic_type: deposit.logistic_type,
          lane: deposit.lane,
          headline: deposit.headline,
          counts: deposit.counts,
          order_ids_by_bucket: deposit.order_ids_by_bucket,
          operational_source: deposit.operational_source,
          total_count: totalCount,
          summary_rows: summaryRowsByBucket.today,
          summary_rows_by_bucket: summaryRowsByBucket,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    return response.status(200).json({
      backend_secure: true,
      generated_at: new Date().toISOString(),
      deposits,
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      backend_secure: true,
    });
  }
}
