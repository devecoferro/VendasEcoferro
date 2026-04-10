import type {
  MLDashboardDeposit,
  MLDashboardSummaryRow,
  MLOrder,
} from "@/services/mercadoLivreService";

export type ShipmentBucket = "today" | "upcoming" | "in_transit" | "finalized";
export type SortOption = "sale_date_desc" | "sale_date_asc";
export type BuyerTypeFilter = "person" | "business";
export type StatusFilterOption = "under_review" | "invoice_pending";
export type DeliveryFormFilter = "collection";
export type FilterOrigin = "native_api" | "operational_internal";
export type OperationalSummaryKey =
  | "cancelled"
  | "overdue"
  | "invoice_pending"
  | "ready"
  | "fulfillment";

export interface MercadoLivreFilters {
  sort: SortOption;
  buyerTypes: BuyerTypeFilter[];
  statuses: StatusFilterOption[];
  deliveryForms: DeliveryFormFilter[];
}

export interface OrderDepositInfo {
  key: string;
  label: string;
  displayLabel: string;
  hasDeposit: boolean;
  logisticType: string;
  isFulfillment: boolean;
}

export interface ShipmentPresentation {
  title: string;
  description: string;
}

export interface DepositOptionPresentation {
  key: string;
  label: string;
  displayLabel: string;
  isFulfillment: boolean;
  kind: "without-deposit" | "deposit";
}

export interface OperationalCardPresentation {
  lane: string;
  headline: string;
  totalCount: number;
  summaryRows: MLDashboardSummaryRow[];
}

export interface OperationalSummaryFilter {
  depositKey: string;
  summaryKey: OperationalSummaryKey;
}

export interface FilterOptionDefinition<T extends string> {
  value: T;
  label: string;
  origin: FilterOrigin;
  sourceLabel: string;
}

const PT_SHORT_MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const OPEN_STATUSES = new Set(["pending", "handling", "ready_to_ship"]);
const FINAL_EXCEPTION_STATUSES = new Set(["cancelled", "not_delivered", "returned"]);
const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";
const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const SHIPMENT_BUCKET_LABELS: Record<ShipmentBucket, string> = {
  today: "Envios de hoje",
  upcoming: "Próximos dias",
  in_transit: "Em trânsito",
  finalized: "Finalizadas",
};

export const DEFAULT_ML_FILTERS: MercadoLivreFilters = {
  sort: "sale_date_desc",
  buyerTypes: [],
  statuses: [],
  deliveryForms: [],
};

export const BUYER_TYPE_FILTER_OPTIONS: Array<FilterOptionDefinition<BuyerTypeFilter>> = [
  {
    value: "person",
    label: "Pessoa",
    origin: "operational_internal",
    sourceLabel: "Operacional interno",
  },
  {
    value: "business",
    label: "Negócio",
    origin: "operational_internal",
    sourceLabel: "Operacional interno",
  },
];

export const STATUS_FILTER_OPTIONS: Array<FilterOptionDefinition<StatusFilterOption>> = [
  {
    value: "under_review",
    label: "Em revisão",
    origin: "operational_internal",
    sourceLabel: "Operacional interno",
  },
  {
    value: "invoice_pending",
    label: "NF-e sem emitir",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
];

export const DELIVERY_FILTER_OPTIONS: Array<FilterOptionDefinition<DeliveryFormFilter>> = [
  {
    value: "collection",
    label: "Para coleta",
    origin: "operational_internal",
    sourceLabel: "Operacional interno",
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCalendarKey(date: Date): string {
  return calendarFormatter.format(date);
}

function getDateKey(value?: string | null): string | null {
  const parsed = parseDate(value);
  return parsed ? buildCalendarKey(parsed) : null;
}

function getSlaDateKey(value: unknown): string | null {
  if (typeof value === "string") {
    const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (matched) {
      return matched[1];
    }
  }

  return getDateKey(typeof value === "string" ? value : null);
}

function toDisplayDepositLabel(label: string): string {
  if (normalizeState(label) === "vendas sem deposito") {
    return "Vendas sem depósito";
  }

  return label;
}

function isSameOrPastCalendarDay(leftKey: string | null, rightKey: string): boolean {
  return Boolean(leftKey && leftKey <= rightKey);
}

function isOpenOperationalOrder(order: MLOrder): boolean {
  const shipmentStatus = normalizeState(getShipmentSnapshot(order).status || order.order_status);
  return OPEN_STATUSES.has(shipmentStatus);
}

export function normalizeState(value: unknown, fallback = ""): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || fallback;
}

export function getRawData(order: MLOrder): Record<string, unknown> {
  return asRecord(order.raw_data) ?? {};
}

export function getShipmentSnapshot(order: MLOrder): Record<string, unknown> {
  return asRecord(getRawData(order).shipment_snapshot) ?? {};
}

export function getSlaSnapshot(order: MLOrder): Record<string, unknown> {
  return asRecord(getRawData(order).sla_snapshot) ?? {};
}

export function getDepositSnapshot(order: MLOrder): Record<string, unknown> {
  return asRecord(getRawData(order).deposit_snapshot) ?? {};
}

export function getBillingInfoSnapshot(order: MLOrder): Record<string, unknown> {
  return asRecord(getRawData(order).billing_info_snapshot) ?? {};
}

export function getBillingInfoStatus(order: MLOrder): string {
  return normalizeState(getRawData(order).billing_info_status, "unknown");
}

export function hasBillingInfoSnapshot(order: MLOrder): boolean {
  if (getBillingInfoStatus(order) === "available") {
    return true;
  }

  return Object.keys(getBillingInfoSnapshot(order)).length > 0;
}

export function getPayments(order: MLOrder): Record<string, unknown>[] {
  return asRecordArray(getRawData(order).payments);
}

export function getDepositInfo(order: MLOrder): OrderDepositInfo {
  const depositSnapshot = getDepositSnapshot(order);
  const key = normalizeText(depositSnapshot.key) || "without-deposit";
  const label = normalizeText(depositSnapshot.label) || "Vendas sem deposito";
  const logisticType =
    normalizeState(depositSnapshot.logistic_type) ||
    normalizeState(getShipmentSnapshot(order).logistic_type) ||
    "unknown";
  const isFulfillment = logisticType === "fulfillment";

  return {
    key,
    label,
    displayLabel: toDisplayDepositLabel(isFulfillment ? "Full" : label),
    logisticType,
    hasDeposit: key !== "without-deposit",
    isFulfillment,
  };
}

export function buildDepositOptions(orders: MLOrder[]): DepositOptionPresentation[] {
  const optionsMap = new Map<string, DepositOptionPresentation>();

  for (const order of orders) {
    const deposit = getDepositInfo(order);

    if (deposit.key === "without-deposit") {
      optionsMap.set(deposit.key, {
        key: deposit.key,
        label: deposit.label,
        displayLabel: "Vendas sem depósito",
        isFulfillment: false,
        kind: "without-deposit",
      });
      continue;
    }

    optionsMap.set(deposit.key, {
      key: deposit.key,
      label: deposit.label,
      displayLabel: deposit.displayLabel,
      isFulfillment: deposit.isFulfillment,
      kind: "deposit",
    });
  }

  const withoutDeposit = optionsMap.get("without-deposit") ?? null;
  const regularDeposits = Array.from(optionsMap.values())
    .filter((option) => option.kind === "deposit" && !option.isFulfillment)
    .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, "pt-BR"));
  const fulfillmentDeposits = Array.from(optionsMap.values())
    .filter((option) => option.kind === "deposit" && option.isFulfillment)
    .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, "pt-BR"));

  return [
    ...(withoutDeposit ? [withoutDeposit] : []),
    ...regularDeposits,
    ...fulfillmentDeposits,
  ];
}

export function getSelectedDepositLabel(
  depositFilters: string[],
  depositOptions: DepositOptionPresentation[]
): string {
  if (depositFilters.length === 0) return "Todas as vendas";

  const selectedLabels = depositFilters
    .map((depositFilter) => depositOptions.find((option) => option.key === depositFilter)?.displayLabel)
    .filter((label): label is string => Boolean(label));

  if (selectedLabels.length === 0) {
    return "Todas as vendas";
  }

  if (selectedLabels.length === 1) {
    return selectedLabels[0];
  }

  if (selectedLabels.length === 2) {
    return `${selectedLabels[0]} + ${selectedLabels[1]}`;
  }

  return `${selectedLabels.length} locais selecionados`;
}

export function sortDashboardDepositsForDisplay<T extends Pick<OrderDepositInfo, "key" | "isFulfillment" | "displayLabel">>(
  deposits: T[]
): T[] {
  const getRank = (deposit: T) => {
    if (deposit.key === "without-deposit") return 2;
    if (deposit.isFulfillment) return 3;
    return 1;
  };

  return [...deposits].sort((left, right) => {
    const rankDiff = getRank(left) - getRank(right);
    if (rankDiff !== 0) return rankDiff;
    return left.displayLabel.localeCompare(right.displayLabel, "pt-BR");
  });
}

export function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatShortDate(dateString?: string | null): string {
  const parsed = parseDate(dateString);
  if (!parsed) return "";
  return `${parsed.getDate()} ${PT_SHORT_MONTHS[parsed.getMonth()]}`;
}

export function formatShortTime(dateString?: string | null): string {
  const parsed = parseDate(dateString);
  if (!parsed) return "--:--";
  return `${padDatePart(parsed.getHours())}:${padDatePart(parsed.getMinutes())}`;
}

export function formatSaleMoment(dateString: string): string {
  const parsed = parseDate(dateString);
  if (!parsed) return "-";
  return `${parsed.getDate()} ${PT_SHORT_MONTHS[parsed.getMonth()]} ${padDatePart(parsed.getHours())}:${padDatePart(parsed.getMinutes())} hs`;
}

export function capitalizeText(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function matchesSearch(order: MLOrder, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const itemSearchable = (order.items || []).flatMap((item) => [
    item.item_title || "",
    item.sku || "",
  ]);

  const searchable = [
    order.sale_number,
    order.order_id,
    order.sku || "",
    order.buyer_name || "",
    order.buyer_nickname || "",
    order.item_title || "",
    ...itemSearchable,
  ];

  return searchable.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function getBuyerType(order: MLOrder): BuyerTypeFilter {
  const rawData = getRawData(order);
  const context = asRecord(rawData.context) ?? {};
  const flows = Array.isArray(context.flows) ? context.flows : [];
  const tags = Array.isArray(rawData.tags) ? rawData.tags : [];

  const isBusiness = [...flows, ...tags].some((value) => normalizeState(value) === "b2b");
  return isBusiness ? "business" : "person";
}

export function isOrderUnderReview(order: MLOrder): boolean {
  const rawData = getRawData(order);
  const shipmentSnapshot = getShipmentSnapshot(order);
  const orderStatus = normalizeState(rawData.status || order.order_status);
  const shipmentStatus = normalizeState(shipmentSnapshot.status);
  const shipmentSubstatus = normalizeState(shipmentSnapshot.substatus);

  if (["under_review", "review", "payment_required", "payment_in_process"].includes(orderStatus)) {
    return true;
  }

  if (["review", "under_review"].includes(shipmentStatus)) {
    return true;
  }

  if (["under_review", "waiting_for_review", "pending_review"].includes(shipmentSubstatus)) {
    return true;
  }

  return getPayments(order).some((payment) =>
    ["in_process", "pending", "under_review"].includes(normalizeState(payment.status))
  );
}

export function isOrderReadyForInvoiceLabel(order: MLOrder): boolean {
  const rawData = getRawData(order);
  const shipmentStatus = normalizeState(getShipmentSnapshot(order).status);
  const orderStatus = normalizeState(rawData.status || order.order_status);

  const hasApprovedPayment =
    getPayments(order).length === 0
      ? ["paid", "confirmed"].includes(orderStatus)
      : getPayments(order).some((payment) => normalizeState(payment.status) === "approved");

  return hasApprovedPayment && shipmentStatus === "ready_to_ship";
}

export function isOrderReadyToPrintLabel(order: MLOrder): boolean {
  return (
    isOrderReadyForInvoiceLabel(order) &&
    normalizeState(getShipmentSnapshot(order).substatus) !== "invoice_pending"
  );
}

export function isOrderInvoicePending(order: MLOrder): boolean {
  const shipmentSnapshot = getShipmentSnapshot(order);
  return (
    isOrderReadyForInvoiceLabel(order) &&
    normalizeState(shipmentSnapshot.substatus) === "invoice_pending"
  );
}

export function isOrderForCollection(order: MLOrder): boolean {
  const shipmentSnapshot = getShipmentSnapshot(order);
  const shippingOption = asRecord(shipmentSnapshot.shipping_option) ?? {};
  const deliveryName = normalizeState(shippingOption.name);
  const logisticType = normalizeState(
    shipmentSnapshot.logistic_type || getDepositInfo(order).logisticType
  );

  return (
    logisticType === "cross_docking" ||
    deliveryName.includes("coleta") ||
    deliveryName.includes("retirada")
  );
}

export function isOrderFinalException(order: MLOrder): boolean {
  const shipmentStatus = normalizeState(getShipmentSnapshot(order).status || order.order_status);
  return FINAL_EXCEPTION_STATUSES.has(shipmentStatus);
}

export function isOrderOverdue(order: MLOrder, referenceDate = new Date()): boolean {
  if (
    !isOpenOperationalOrder(order) ||
    isOrderInvoicePending(order) ||
    isOrderReadyToPrintLabel(order)
  ) {
    return false;
  }

  const shipmentSnapshot = getShipmentSnapshot(order);
  const statusHistory = asRecord(shipmentSnapshot.status_history) ?? {};
  const shippingOption = asRecord(shipmentSnapshot.shipping_option) ?? {};
  const dueDateKey =
    getSlaDateKey(getSlaSnapshot(order).expected_date) ||
    getSlaDateKey(shippingOption.estimated_delivery_limit) ||
    getSlaDateKey(shippingOption.estimated_delivery_final) ||
    getDateKey(normalizeText(statusHistory.date_handling)) ||
    getDateKey(normalizeText(statusHistory.date_ready_to_ship));

  if (!dueDateKey) {
    return false;
  }

  return isSameOrPastCalendarDay(dueDateKey, buildCalendarKey(referenceDate));
}

export function matchesSupportedFilters(
  order: MLOrder,
  filters: MercadoLivreFilters
): boolean {
  if (filters.buyerTypes.length > 0 && !filters.buyerTypes.includes(getBuyerType(order))) {
    return false;
  }

  if (
    filters.statuses.length > 0 &&
    !filters.statuses.some((statusFilter) => {
      if (statusFilter === "under_review") return isOrderUnderReview(order);
      if (statusFilter === "invoice_pending") return isOrderInvoicePending(order);
      return false;
    })
  ) {
    return false;
  }

  if (
    filters.deliveryForms.length > 0 &&
    !filters.deliveryForms.some((deliveryForm) => {
      if (deliveryForm === "collection") return isOrderForCollection(order);
      return false;
    })
  ) {
    return false;
  }

  return true;
}

export function sortOrders(orders: MLOrder[], sort: SortOption): MLOrder[] {
  const sorted = [...orders];
  sorted.sort((left, right) => {
    const leftTime = parseDate(left.sale_date)?.getTime() ?? 0;
    const rightTime = parseDate(right.sale_date)?.getTime() ?? 0;
    return sort === "sale_date_asc" ? leftTime - rightTime : rightTime - leftTime;
  });
  return sorted;
}

export function filterAndSortOrders(
  orders: MLOrder[],
  searchQuery: string,
  filters: MercadoLivreFilters
): MLOrder[] {
  const filtered = orders.filter(
    (order) => matchesSearch(order, searchQuery) && matchesSupportedFilters(order, filters)
  );
  return sortOrders(filtered, filters.sort);
}

export function getShipmentPresentation(order: MLOrder): ShipmentPresentation {
  const rawData = getRawData(order);
  const shipmentSnapshot = getShipmentSnapshot(order);
  const status = normalizeState(shipmentSnapshot.status || order.order_status, "unknown");
  const substatus = normalizeState(shipmentSnapshot.substatus, "");
  const shippingOption = asRecord(shipmentSnapshot.shipping_option) ?? {};
  const estimatedDate =
    normalizeText(shippingOption.estimated_delivery_final) ||
    normalizeText(shippingOption.estimated_delivery_limit) ||
    normalizeText(getSlaSnapshot(order).expected_date) ||
    null;
  const formattedEstimatedDate = formatShortDate(estimatedDate);

  switch (status) {
    case "ready_to_ship":
      return {
        title: "Pronta para emitir NF-e",
        description: "Pagamento aprovado e expedição liberada para gerar etiqueta.",
      };
    case "pending":
    case "handling":
      if (substatus === "buffered") {
        return {
          title: "Preparando o envio",
          description: formattedEstimatedDate
            ? `Coleta prevista até ${formattedEstimatedDate}.`
            : "Pedido aguardando processamento logístico.",
        };
      }

      return {
        title: "Em preparação",
        description: formattedEstimatedDate
          ? `Expedição prevista até ${formattedEstimatedDate}.`
          : "Pedido em separação para envio.",
      };
    case "shipped":
    case "in_transit":
      return {
        title: "A caminho",
        description: formattedEstimatedDate
          ? `Chega até ${formattedEstimatedDate}.`
          : "Pedido já saiu para transporte.",
      };
    case "delivered":
      return {
        title: "Entregue",
        description: "O pedido já foi entregue ao comprador.",
      };
    case "cancelled":
      return {
        title: "Cancelada",
        description: "Venda encerrada antes da expedição.",
      };
    case "returned":
    case "not_delivered":
      return {
        title: "Ocorrência no envio",
        description: "O transporte registrou devolução ou insucesso.",
      };
    default:
      return {
        title: capitalizeText(status.replace(/_/g, " ")),
        description: formattedEstimatedDate
          ? `Atualização operacional prevista até ${formattedEstimatedDate}.`
          : "Acompanhamento logístico em andamento.",
      };
  }
}

export function getOperationalLane(deposit: MLDashboardDeposit): string {
  if (deposit.lane) {
    return deposit.lane;
  }

  if (deposit.key === "without-deposit") {
    return "SEM DEPÓSITO";
  }

  return deposit.logistic_type === "fulfillment" ? "EM ANDAMENTO" : "PROGRAMADA";
}

export function getOperationalCardTitle(deposit: MLDashboardDeposit): string {
  if (deposit.headline) {
    return deposit.headline;
  }

  if (deposit.key === "without-deposit") {
    return "Operação sem depósito";
  }

  return deposit.logistic_type === "fulfillment"
    ? toDisplayDepositLabel(deposit.label)
    : `Coleta | ${toDisplayDepositLabel(deposit.label)}`;
}

export function getOperationalTotalCount(deposit: MLDashboardDeposit): number {
  if (typeof deposit.internal_operational_total_count === "number") {
    return deposit.internal_operational_total_count;
  }

  if (typeof deposit.total_count === "number") {
    return deposit.total_count;
  }

  return Object.values(
    deposit.internal_operational_counts || deposit.counts || {}
  ).reduce((total, count) => total + (count || 0), 0);
}

function buildCrossDockingSummaryRows(orders: MLOrder[], referenceDate = new Date()): MLDashboardSummaryRow[] {
  let cancelled = 0;
  let overdue = 0;
  let invoicePending = 0;
  let ready = 0;

  for (const order of orders) {
    if (isOrderFinalException(order)) {
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

    if (isOrderOverdue(order, referenceDate)) {
      overdue += 1;
    }
  }

  return [
    { key: "cancelled", label: "Canceladas. Não enviar", count: cancelled },
    { key: "overdue", label: "Atrasadas. Enviar", count: overdue },
    { key: "invoice_pending", label: "NF-e para gerenciar", count: invoicePending },
    { key: "ready", label: "Prontas para enviar", count: ready },
  ];
}

function buildFulfillmentSummaryRows(
  orders: MLOrder[],
  activeBucket: ShipmentBucket
): MLDashboardSummaryRow[] {
  const label = getOperationalSummaryLabel("fulfillment", activeBucket);

  return [{ key: "fulfillment", label, count: orders.length }];
}

export function getOperationalSummaryLabel(
  summaryKey: OperationalSummaryKey,
  activeBucket: ShipmentBucket
): string {
  if (summaryKey === "fulfillment") {
    return activeBucket === "in_transit"
      ? "Em trânsito"
      : activeBucket === "finalized"
        ? "Finalizadas"
        : "No centro de distribuição";
  }

  const labels: Record<Exclude<OperationalSummaryKey, "fulfillment">, string> = {
    cancelled: "Canceladas. Não enviar",
    overdue: "Atrasadas. Enviar",
    invoice_pending: "NF-e para gerenciar",
    ready: "Prontas para enviar",
  };

  return labels[summaryKey];
}

export function matchesOperationalSummaryRow(
  order: MLOrder,
  summaryKey: OperationalSummaryKey,
  activeBucket: ShipmentBucket,
  referenceDate = new Date()
): boolean {
  switch (summaryKey) {
    case "cancelled":
      return isOrderFinalException(order);
    case "overdue":
      return isOrderOverdue(order, referenceDate);
    case "invoice_pending":
      return isOrderInvoicePending(order);
    case "ready":
      return isOrderReadyToPrintLabel(order);
    case "fulfillment":
      return getDepositInfo(order).isFulfillment && activeBucket !== "finalized"
        ? !isOrderFinalException(order)
        : getDepositInfo(order).isFulfillment;
    default:
      return false;
  }
}

export function getOperationalSummaryRows(
  deposit: MLDashboardDeposit,
  orders: MLOrder[],
  activeBucket: ShipmentBucket
): MLDashboardSummaryRow[] {
  const summaryRowsByBucket =
    deposit.internal_operational_summary_rows_by_bucket?.[activeBucket] ||
    deposit.summary_rows_by_bucket?.[activeBucket];
  const hasMeaningfulBucketSummary =
    Array.isArray(summaryRowsByBucket) && summaryRowsByBucket.some((row) => row.count > 0);

  if (hasMeaningfulBucketSummary) {
    return summaryRowsByBucket;
  }

  if (orders.length === 0) {
    if (Array.isArray(deposit.summary_rows) && deposit.summary_rows.length > 0) {
      return deposit.summary_rows;
    }

    return deposit.logistic_type === "fulfillment"
      ? buildFulfillmentSummaryRows([], activeBucket)
      : buildCrossDockingSummaryRows([]);
  }

  return deposit.logistic_type === "fulfillment"
    ? buildFulfillmentSummaryRows(orders, activeBucket)
    : buildCrossDockingSummaryRows(orders);
}

export function getOperationalCardPresentation(
  deposit: MLDashboardDeposit,
  orders: MLOrder[],
  activeBucket: ShipmentBucket
): OperationalCardPresentation {
  const summaryRows = getOperationalSummaryRows(deposit, orders, activeBucket);
  const bucketTotal =
    deposit.internal_operational_counts?.[activeBucket] ?? deposit.counts?.[activeBucket];
  const totalCount =
    typeof bucketTotal === "number"
      ? bucketTotal
      : orders.length > 0
        ? orders.length
        : summaryRows.reduce((total, row) => total + row.count, 0);

  return {
    lane: getOperationalLane(deposit),
    headline: getOperationalCardTitle(deposit),
    totalCount,
    summaryRows,
  };
}

export function getOrderImageFallback(order: MLOrder): string {
  if (order.sku) return order.sku;
  if (order.items?.[0]?.sku) return order.items[0].sku || "";
  if (order.sale_number) return `#${order.sale_number.slice(-4)}`;
  return "ML";
}

