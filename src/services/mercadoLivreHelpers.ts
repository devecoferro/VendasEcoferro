import type {
  MLDashboardDeposit,
  MLDashboardSummaryRow,
  MLOrder,
} from "@/services/mercadoLivreService";

export type ShipmentBucket =
  | "today"
  | "upcoming"
  | "in_transit"
  | "finalized"
  | "cancelled";
export type SortOption =
  | "sale_date_desc"
  | "sale_date_asc"
  | "amount_desc"
  | "amount_asc";
export type BuyerTypeFilter = "person" | "business";
export type StatusFilterOption =
  | "under_review"
  | "invoice_pending"
  | "label_ready"
  | "ready_to_ship"
  | "processing_warehouse"
  | "in_transit"
  | "completed"
  | "not_completed"
  | "cancelled";
export type DeliveryFormFilter = "collection" | "fulfillment";
export type InvoiceFilterOption = "missing_fiscal_data";
export type FilterOrigin = "native_api" | "operational_internal";
export type OperationalSummaryKey =
  | "cancelled"
  | "overdue"
  | "invoice_pending"
  | "ready"
  | "labels_to_print"
  | "processing"
  | "default_shipping"
  | "waiting_pickup"
  | "in_transit_collection"
  | "not_delivered"
  | "complaints"
  | "fulfillment";

export interface MercadoLivreFilters {
  sort: SortOption;
  buyerTypes: BuyerTypeFilter[];
  statuses: StatusFilterOption[];
  deliveryForms: DeliveryFormFilter[];
  invoiceStates: InvoiceFilterOption[];
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
  cancelled: "Canceladas",
};

export const DEFAULT_ML_FILTERS: MercadoLivreFilters = {
  sort: "sale_date_desc",
  buyerTypes: [],
  statuses: [],
  deliveryForms: [],
  invoiceStates: [],
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
  {
    value: "label_ready",
    label: "Etiquetas para imprimir",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "ready_to_ship",
    label: "Prontas para enviar",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "processing_warehouse",
    label: "Processando no centro de distribuição",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "in_transit",
    label: "A caminho",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "completed",
    label: "Concluídas",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "not_completed",
    label: "Não concluídas",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
  {
    value: "cancelled",
    label: "Canceladas",
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
  {
    value: "fulfillment",
    label: "Mercado Envios Full",
    origin: "native_api",
    sourceLabel: "API do ML",
  },
];

export const INVOICE_FILTER_OPTIONS: Array<FilterOptionDefinition<InvoiceFilterOption>> = [
  {
    value: "missing_fiscal_data",
    label: "Sem dados fiscais",
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

/**
 * Verifica se o pedido possui pagamento aprovado.
 * Usado para calcular receita real — exclui pedidos pendentes sem pagamento.
 */
export function hasConfirmedPayment(order: MLOrder): boolean {
  const rawData = getRawData(order);
  const orderStatus = normalizeState(rawData.status || order.order_status);
  const payments = getPayments(order);

  // Se não há array de payments, infere do status do pedido
  if (payments.length === 0) {
    return ["paid", "confirmed"].includes(orderStatus);
  }

  // Pelo menos um pagamento deve estar aprovado
  return payments.some(
    (payment) => normalizeState(payment.status) === "approved"
  );
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

  // "Vendas sem deposito" sempre presente (espelha o Seller Center, que mostra
  // a opcao mesmo quando nao ha pedidos sem deposito no filtro atual).
  optionsMap.set("without-deposit", {
    key: "without-deposit",
    label: "Vendas sem deposito",
    displayLabel: "Vendas sem depósito",
    isFulfillment: false,
    kind: "without-deposit",
  });

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

export function hasEmittedInvoice(order: MLOrder): boolean {
  const rawData = getRawData(order) as Record<string, unknown> | null;
  return rawData?.__nfe_emitted === true;
}

export function isOrderReadyToPrintLabel(order: MLOrder): boolean {
  if (!isOrderReadyForInvoiceLabel(order)) return false;
  const substatus = normalizeState(getShipmentSnapshot(order).substatus);
  if (substatus === "invoice_pending") {
    // NFe ja emitida no nosso sistema -> liberado para imprimir etiqueta.
    return hasEmittedInvoice(order);
  }
  return true;
}

export function isOrderInvoicePending(order: MLOrder): boolean {
  if (!isOrderReadyForInvoiceLabel(order)) return false;
  if (hasEmittedInvoice(order)) return false;
  const shipmentSnapshot = getShipmentSnapshot(order);
  return normalizeState(shipmentSnapshot.substatus) === "invoice_pending";
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

export function isOrderFulfillment(order: MLOrder): boolean {
  const shipmentSnapshot = getShipmentSnapshot(order);
  const logisticType = normalizeState(
    shipmentSnapshot.logistic_type || getDepositInfo(order).logisticType
  );
  return logisticType === "fulfillment";
}

/**
 * Verifica se o pedido tem etiqueta ML de envio disponivel para impressao.
 *
 * Pedidos FULL (fulfillment) NAO tem etiqueta ML publica — o ML gera
 * e usa internamente no centro de distribuicao. O backend pula a chamada
 * a API ML para esses pedidos (fetchShippingLabelRecord retorna unavailable).
 *
 * Usado para:
 * - Contagem do botao "Imprimir etiqueta ML + DANFe (N)"
 * - Habilitar/desabilitar o botao por pedido no card
 */
export function canPrintMLShippingLabel(order: MLOrder): boolean {
  return isOrderReadyToPrintLabel(order) && !isOrderFulfillment(order);
}

function getShipmentStatus(order: MLOrder): string {
  return normalizeState(getShipmentSnapshot(order).status || order.order_status);
}

function getShipmentSubstatus(order: MLOrder): string {
  return normalizeState(getShipmentSnapshot(order).substatus);
}

export function isOrderLabelReady(order: MLOrder): boolean {
  // Etiquetas para imprimir = pronta com NF-e emitida (mesma regra de
  // isOrderReadyToPrintLabel, mas nomeada para alinhar com ML Seller Center).
  return isOrderReadyToPrintLabel(order);
}

export function isOrderReadyToShipNow(order: MLOrder): boolean {
  // "Prontas para enviar" — substatuses que o ML agrupa no bucket "Envios de hoje".
  const status = getShipmentStatus(order);
  if (status !== "ready_to_ship") return false;
  const sub = getShipmentSubstatus(order);
  return [
    "ready_for_pickup",
    "in_warehouse",
    "ready_to_pack",
    "packed",
    "in_packing_list",
  ].includes(sub);
}

export function isOrderProcessingWarehouse(order: MLOrder): boolean {
  // "Processando no centro de distribuição" — transicao: buffered (em fila),
  // picked_up / authorized_by_carrier (transportadora pegou, aguardando embarque).
  const status = getShipmentStatus(order);
  const sub = getShipmentSubstatus(order);
  if (["pending", "handling"].includes(status) && sub === "buffered") return true;
  if (status === "ready_to_ship" && ["picked_up", "authorized_by_carrier"].includes(sub)) {
    return true;
  }
  return false;
}

export function isOrderInTransit(order: MLOrder): boolean {
  // "A caminho" — shipped sem estar esperando retirada no ponto.
  const status = getShipmentStatus(order);
  if (status === "in_transit") return true;
  if (status === "shipped") {
    const sub = getShipmentSubstatus(order);
    return sub !== "waiting_for_withdrawal";
  }
  return false;
}

export function isOrderCompleted(order: MLOrder): boolean {
  return getShipmentStatus(order) === "delivered";
}

export function isOrderNotCompleted(order: MLOrder): boolean {
  const status = getShipmentStatus(order);
  return status === "not_delivered" || status === "returned";
}

export function isOrderCancelled(order: MLOrder): boolean {
  return getShipmentStatus(order) === "cancelled";
}

export function isOrderMissingFiscalData(order: MLOrder): boolean {
  // "Sem dados fiscais" — billing_info_status nao indica que tem dados completos.
  // Valores possiveis: "ok", "available", "pending", "missing", "" (vazio).
  // Consideramos sem dados qualquer coisa diferente de "ok"/"available" OU quando
  // nao ha snapshot de billing.
  const status = getBillingInfoStatus(order);
  if (status === "ok" || status === "available") return false;
  return !hasBillingInfoSnapshot(order);
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
      switch (statusFilter) {
        case "under_review":
          return isOrderUnderReview(order);
        case "invoice_pending":
          return isOrderInvoicePending(order);
        case "label_ready":
          return isOrderLabelReady(order);
        case "ready_to_ship":
          return isOrderReadyToShipNow(order);
        case "processing_warehouse":
          return isOrderProcessingWarehouse(order);
        case "in_transit":
          return isOrderInTransit(order);
        case "completed":
          return isOrderCompleted(order);
        case "not_completed":
          return isOrderNotCompleted(order);
        case "cancelled":
          return isOrderCancelled(order);
        default:
          return false;
      }
    })
  ) {
    return false;
  }

  if (
    filters.deliveryForms.length > 0 &&
    !filters.deliveryForms.some((deliveryForm) => {
      if (deliveryForm === "collection") return isOrderForCollection(order);
      if (deliveryForm === "fulfillment") return isOrderFulfillment(order);
      return false;
    })
  ) {
    return false;
  }

  if (
    filters.invoiceStates.length > 0 &&
    !filters.invoiceStates.some((invoiceState) => {
      if (invoiceState === "missing_fiscal_data") return isOrderMissingFiscalData(order);
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
    if (sort === "amount_desc" || sort === "amount_asc") {
      const leftAmount = Number(left.amount) || 0;
      const rightAmount = Number(right.amount) || 0;
      return sort === "amount_asc" ? leftAmount - rightAmount : rightAmount - leftAmount;
    }
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
  const counts: Record<string, number> = {
    cancelled: 0,
    overdue: 0,
    invoice_pending: 0,
    ready: 0,
    labels_to_print: 0,
    processing: 0,
    default_shipping: 0,
    waiting_pickup: 0,
    in_transit_collection: 0,
    not_delivered: 0,
    complaints: 0,
  };

  for (const order of orders) {
    const snapshot = getShipmentSnapshot(order);
    const status = String(snapshot.status || "").toLowerCase();
    const substatus = String(snapshot.substatus || "").toLowerCase();

    if (status === "cancelled") { counts.cancelled += 1; continue; }
    if (status === "not_delivered") { counts.not_delivered += 1; continue; }
    if (status === "returned") { counts.complaints += 1; continue; }
    if (isOrderInvoicePending(order)) { counts.invoice_pending += 1; continue; }
    if (substatus === "ready_to_print") { counts.labels_to_print += 1; continue; }
    if (
      substatus === "in_warehouse" ||
      substatus === "ready_to_pack" ||
      substatus === "packed" ||
      substatus === "in_packing_list"
    ) { counts.processing += 1; continue; }
    if (status === "shipped" && substatus === "waiting_for_withdrawal") {
      counts.waiting_pickup += 1;
      continue;
    }
    if (status === "shipped" && (substatus === "out_for_delivery" || substatus === "none" || substatus === "")) {
      counts.in_transit_collection += 1;
      continue;
    }
    if (isOrderReadyToPrintLabel(order)) { counts.ready += 1; continue; }
    if (status === "pending" || substatus === "pending") { counts.default_shipping += 1; continue; }
    if (isOrderOverdue(order, referenceDate)) { counts.overdue += 1; }
  }

  const rows: MLDashboardSummaryRow[] = [
    { key: "cancelled", label: "Canceladas. Não enviar", count: counts.cancelled },
    { key: "overdue", label: "Atrasadas. Enviar", count: counts.overdue },
    { key: "invoice_pending", label: "NF-e para gerenciar", count: counts.invoice_pending },
    { key: "labels_to_print", label: "Etiquetas para imprimir", count: counts.labels_to_print },
    { key: "processing", label: "Em processamento", count: counts.processing },
    { key: "default_shipping", label: "Por envio padrão", count: counts.default_shipping },
    { key: "ready", label: "Prontas para enviar", count: counts.ready },
    { key: "waiting_pickup", label: "Esperando retirada do comprador", count: counts.waiting_pickup },
    { key: "in_transit_collection", label: "A caminho - Coleta", count: counts.in_transit_collection },
    { key: "not_delivered", label: "Não entregues", count: counts.not_delivered },
    { key: "complaints", label: "Com reclamação ou mediação", count: counts.complaints },
  ];

  // Retorna só linhas com count > 0 (igual ML Seller Center)
  return rows.filter((r) => r.count > 0);
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
    if (activeBucket === "in_transit") return "Em trânsito";
    if (activeBucket === "finalized") return "Finalizadas";
    if (activeBucket === "cancelled") return "Canceladas";
    return "No centro de distribuição";
  }

  const labels: Record<Exclude<OperationalSummaryKey, "fulfillment">, string> = {
    cancelled: "Canceladas. Não enviar",
    overdue: "Atrasadas. Enviar",
    invoice_pending: "NF-e para gerenciar",
    ready: "Prontas para enviar",
    labels_to_print: "Etiquetas para imprimir",
    processing: "Em processamento",
    default_shipping: "Por envio padrão",
    waiting_pickup: "Esperando retirada do comprador",
    in_transit_collection: "A caminho - Coleta",
    not_delivered: "Não entregues",
    complaints: "Com reclamação ou mediação",
  };

  return labels[summaryKey];
}

export function matchesOperationalSummaryRow(
  order: MLOrder,
  summaryKey: OperationalSummaryKey,
  activeBucket: ShipmentBucket,
  referenceDate = new Date()
): boolean {
  const snapshot = getShipmentSnapshot(order);
  const status = String(snapshot.status || "").toLowerCase();
  const substatus = String(snapshot.substatus || "").toLowerCase();

  switch (summaryKey) {
    case "cancelled":
      return isOrderFinalException(order);
    case "overdue":
      return isOrderOverdue(order, referenceDate);
    case "invoice_pending":
      return isOrderInvoicePending(order);
    case "ready":
      return isOrderReadyToPrintLabel(order);
    case "labels_to_print":
      return substatus === "ready_to_print";
    case "processing":
      return (
        substatus === "in_warehouse" ||
        substatus === "ready_to_pack" ||
        substatus === "packed" ||
        substatus === "in_packing_list"
      );
    case "default_shipping":
      return status === "pending" || substatus === "pending";
    case "waiting_pickup":
      return status === "shipped" && substatus === "waiting_for_withdrawal";
    case "in_transit_collection":
      return (
        status === "shipped" &&
        (substatus === "out_for_delivery" || substatus === "none" || substatus === "")
      );
    case "not_delivered":
      return status === "not_delivered";
    case "complaints":
      return status === "returned";
    case "fulfillment":
      return getDepositInfo(order).isFulfillment &&
        activeBucket !== "finalized" &&
        activeBucket !== "cancelled"
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

