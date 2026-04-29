import {
  createMLOAuthSession,
  resolveMLRedirectUri,
} from "@/services/mlOAuth";
import type { ProcessingResult } from "@/services/fileProcessor";
import type { SaleItemData } from "@/types/sales";
import { getDepositInfo } from "@/services/mercadoLivreHelpers";

export interface MLConnection {
  id: string;
  seller_id: string;
  seller_nickname: string | null;
  last_sync_at: string | null;
  token_expires_at: string;
  created_at: string;
}

export interface MLOrder {
  id: string;
  order_id: string;
  sale_number: string;
  sale_date: string;
  buyer_name: string | null;
  buyer_nickname: string | null;
  item_title: string | null;
  item_id: string | null;
  product_image_url: string | null;
  sku: string | null;
  quantity: number;
  amount: number | null;
  order_status: string | null;
  raw_data: Record<string, unknown> | null;
  items: MLOrderItem[];
  /**
   * ISO-8601 UTC da ultima vez que a etiqueta deste pedido foi impressa.
   * null = nunca impressa (pendente). Usado pelos filtros Com/Sem etiqueta
   * na MercadoLivrePage.
   */
  label_printed_at?: string | null;
  /**
   * Data da coleta agendada pelo ML (lead_time.estimated_schedule_limit.date).
   * null = sem coleta agendada ainda (ML só agenda apos NF+etiqueta prontas).
   * Formato ISO-8601 ("2026-04-23T03:00:00Z" ou similar). Usado pelo
   * ColetasPanel pra agrupar orders por data real sem depender de regex
   * no status_text do scraping.
   */
  pickup_scheduled_date?: string | null;
}

export interface MLOrderItem {
  item_title: string | null;
  sku: string | null;
  quantity: number;
  amount: number | null;
  item_id?: string | null;
  product_image_url?: string | null;
  variation?: string | null;
}

export interface MLOrdersPagination {
  offset: number;
  limit: number;
  total: number;
  loaded: number;
  has_more: boolean;
  next_offset: number | null;
}

export interface MLOrdersResponse {
  orders: MLOrder[];
  pagination: MLOrdersPagination;
}

export type MLOperationalBucket =
  | "today"
  | "upcoming"
  | "in_transit"
  | "finalized"
  | "cancelled";

export interface MLDashboardSummaryRow {
  key: string;
  label: string;
  count: number;
}

export interface MLDashboardMirrorEntityStatus {
  entity: "returns" | "claims" | "packs";
  label: string;
  count: number;
  last_synced_at: string | null;
  last_resource_updated_at: string | null;
  implementation_status: string;
}

export interface MLDashboardStatusBreakdownItem {
  raw_status: string;
  count: number;
}

export interface MLDashboardMirrorEntityOverview extends MLDashboardMirrorEntityStatus {
  status_breakdown?: MLDashboardStatusBreakdownItem[];
}

export interface MLDashboardPostSaleOverview {
  total_open: number;
  entities: {
    claims: MLDashboardMirrorEntityOverview;
    returns: MLDashboardMirrorEntityOverview;
    packs: MLDashboardMirrorEntityOverview;
  };
  private_audit?: MLDashboardPrivatePostSaleAudit;
}

export interface MLDashboardOperationalQueueEntry {
  label: string;
  count: number;
  order_ids?: string[];
  note?: string;
}

export interface MLDashboardOperationalQueues {
  ready_to_print: MLDashboardOperationalQueueEntry;
  invoice_pending: MLDashboardOperationalQueueEntry;
  under_review: MLDashboardOperationalQueueEntry;
  collection_ready: MLDashboardOperationalQueueEntry;
  nfe_sync_pending: MLDashboardOperationalQueueEntry;
  nfe_attention: MLDashboardOperationalQueueEntry;
  post_sale_attention: {
    label: string;
    count: number;
    note: string;
  };
  post_sale_ui_attention?: {
    label: string;
    count: number;
    note: string;
  };
}

export interface MLDashboardCountLayer {
  status: "ready" | "partial";
  note: string;
  source: string;
}

export interface MLDashboardMirrorLayer {
  status: "partial" | "ready";
  incomplete: boolean;
  note: string;
  dependencies_pending: string[];
  entities: {
    returns: MLDashboardMirrorEntityOverview;
    claims: MLDashboardMirrorEntityOverview;
    packs: MLDashboardMirrorEntityOverview;
  };
}

export interface MLDashboardDeposit {
  key: string;
  label: string;
  logistic_type: string;
  internal_operational_counts?: Record<MLOperationalBucket, number>;
  internal_operational_order_ids_by_bucket?: Record<MLOperationalBucket, string[]>;
  internal_operational_source?: string;
  internal_operational_total_count?: number;
  internal_operational_summary_rows?: MLDashboardSummaryRow[];
  internal_operational_summary_rows_by_bucket?: Record<MLOperationalBucket, MLDashboardSummaryRow[]>;
  seller_center_mirror_counts?: Record<MLOperationalBucket, number>;
  seller_center_mirror_order_ids_by_bucket?: Record<MLOperationalBucket, string[]>;
  seller_center_mirror_source?: string;
  seller_center_mirror_total_count?: number;
  seller_center_mirror_status?: "partial" | "ready";
  seller_center_mirror_note?: string;
  counts: Record<MLOperationalBucket, number>;
  native_counts?: Record<MLOperationalBucket, number>;
  order_ids_by_bucket: Record<MLOperationalBucket, string[]>;
  native_order_ids_by_bucket?: Record<MLOperationalBucket, string[]>;
  operational_source: string;
  native_source?: string;
  lane?: string;
  headline?: string;
  total_count?: number;
  native_total_count?: number;
  summary_rows?: MLDashboardSummaryRow[];
  summary_rows_by_bucket?: Record<MLOperationalBucket, MLDashboardSummaryRow[]>;
}

export interface MLLiveChipCounts {
  today: number;
  upcoming: number;
  in_transit: number;
  finalized: number;
  cancelled: number;
}

// Listas de order_ids classificadas pelo ML Seller Center — alimentam a
// lista de cards abaixo do chip selecionado, pareando com os números de
// ml_live_chip_counts (mesma fonte de verdade).
export interface MLLiveChipOrderIdsByBucket {
  today: string[];
  upcoming: string[];
  in_transit: string[];
  finalized: string[];
  cancelled: string[];
}

export interface MLDashboardResponse {
  backend_secure: boolean;
  generated_at: string;
  internal_operational?: MLDashboardCountLayer;
  seller_center_mirror?: MLDashboardMirrorLayer;
  post_sale_overview?: MLDashboardPostSaleOverview;
  operational_queues?: MLDashboardOperationalQueues;
  deposits: MLDashboardDeposit[];
  ml_ui_chip_counts?: MLLiveChipCounts | null;
  ml_ui_chip_counts_stale?: boolean;
  ml_ui_chip_counts_age_seconds?: number | null;
  ml_live_chip_counts?: MLLiveChipCounts;
  ml_live_chip_order_ids_by_bucket?: MLLiveChipOrderIdsByBucket;
}

export interface MLPrivateSellerCenterSnapshotTask {
  key: string;
  label: string;
  count: number;
  card_key?: string | null;
  card_label?: string | null;
}

export interface MLPrivateSellerCenterSnapshotCard {
  key: string;
  label: string;
  count: number;
  tag: string | null;
  tasks: MLPrivateSellerCenterSnapshotTask[];
}

export interface MLPrivateSellerCenterSnapshotRecord {
  id: string;
  connection_id: string | null;
  seller_id: string;
  store: string;
  view_selector: string | null;
  view_label: string | null;
  selected_tab: string | null;
  selected_tab_label: string | null;
  tab_counts: Record<MLOperationalBucket, number>;
  post_sale_count: number;
  cards: MLPrivateSellerCenterSnapshotCard[];
  tasks: MLPrivateSellerCenterSnapshotTask[];
  raw_payload: Record<string, unknown>;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

export interface MLDashboardPrivatePostSaleAuditTotals {
  operational_total: number;
  raw_button_total: number;
  returns_in_progress: number;
  in_review: number;
  completed: number;
  not_completed: number;
  unread_messages: number;
  action_required: number;
}

export interface MLDashboardPrivatePostSaleAuditView {
  store: string;
  view_label: string;
  selected_tab: string | null;
  selected_tab_label: string | null;
  captured_at: string | null;
  source: "cards_tasks" | "button" | "none";
  operational_count: number;
  raw_button_count: number;
  returns_in_progress: number;
  in_review: number;
  completed: number;
  not_completed: number;
  unread_messages: number;
  action_required: number;
  cards: MLPrivateSellerCenterSnapshotCard[];
}

export interface MLDashboardPrivatePostSaleAudit {
  status: "available" | "missing";
  note: string;
  source: string;
  last_captured_at: string | null;
  totals: MLDashboardPrivatePostSaleAuditTotals;
  views: MLDashboardPrivatePostSaleAuditView[];
}

export interface MLPrivateSellerCenterSnapshotStatus {
  status: "available" | "missing";
  total_snapshots: number;
  last_captured_at: string | null;
}

export interface MLPrivateSellerCenterComparisonView {
  store: string;
  view_selector: string | null;
  view_label: string | null;
  selected_tab: string | null;
  selected_tab_label: string | null;
  captured_at: string;
  private_snapshot: {
    status: "available";
    counts: Record<MLOperationalBucket, number>;
    post_sale_count: number;
    post_sale_source?: "cards_tasks" | "button" | "none";
    post_sale_button_count_raw?: number;
    post_sale_breakdown?: {
      returns_in_progress: number;
      in_review: number;
      completed: number;
      not_completed: number;
      unread_messages: number;
      action_required: number;
    };
    cards: MLPrivateSellerCenterSnapshotCard[];
    tasks: MLPrivateSellerCenterSnapshotTask[];
  };
  internal_operational: {
    counts: Record<MLOperationalBucket, number>;
    total_count: number;
    source: string[];
  };
  seller_center_mirror: {
    counts: Record<MLOperationalBucket, number>;
    total_count: number;
    source: string[];
    status: "partial" | "ready";
    note: string | null;
  };
  persisted_entities: {
    orders: number;
    packs: number;
    claims: number;
    returns: number;
  };
  differences: {
    internal_minus_private: Record<MLOperationalBucket, number>;
    mirror_minus_private: Record<MLOperationalBucket, number>;
  };
}

export interface MLPrivateSellerCenterComparisonResponse {
  status: string;
  generated_at: string;
  connection_id: string | null;
  seller_id: string | null;
  snapshot_status: MLPrivateSellerCenterSnapshotStatus;
  internal_operational?: MLDashboardCountLayer | null;
  seller_center_mirror?: MLDashboardMirrorLayer | null;
  views: MLPrivateSellerCenterComparisonView[];
}

export interface MLInternalLabelExisting {
  status: "available";
  flow: string;
  note: string;
  route: string;
  order_id: string;
}

export interface MLShippingLabelExternal {
  status: "available" | "unavailable" | "error";
  source: string;
  fetched_at: string | null;
  label_format: string | null;
  label_content_type?: string | null;
  cache_hit?: boolean;
  note: string;
  view_url: string | null;
  download_url: string | null;
  print_url: string | null;
}

export interface MLInvoiceNFeDocument {
  status: "available" | "partial" | "unavailable" | "error";
  source: string;
  fetched_at: string | null;
  invoice_number: string | null;
  invoice_key: string | null;
  danfe_available: boolean;
  xml_available: boolean;
  cache_hit?: boolean;
  note: string;
  danfe_view_url: string | null;
  danfe_download_url: string | null;
  danfe_print_url: string | null;
  xml_view_url: string | null;
  xml_download_url: string | null;
}

export interface MLOrderDocumentsResponse {
  status: string;
  order_id: string;
  shipment_id: string | null;
  pack_id: string | null;
  seller_id: string | null;
  internal_label_existing: MLInternalLabelExisting;
  shipping_label_external: MLShippingLabelExternal;
  invoice_nfe_document: MLInvoiceNFeDocument;
}

export interface MLNFeReadiness {
  allowed: boolean;
  status: string;
  note: string;
  blocking_reasons?: string[];
  checks?: Array<{
    key: string;
    label: string;
    passed: boolean;
    blocking: boolean;
    value: string | null;
    detail: string | null;
  }>;
}

export interface MLNFeDocument {
  order_id: string;
  shipment_id: string | null;
  pack_id: string | null;
  seller_id: string | null;
  source: string;
  provider: string;
  status:
    | "ready_to_emit"
    | "blocked"
    | "emitting"
    | "authorized"
    | "synced_with_mercadolivre"
    | "pending_sync"
    | "rejected"
    | "error"
    | "pending_data"
    | "pending_configuration"
    | "managed_by_marketplace";
  transaction_status: string | null;
  environment: string | null;
  invoice_number: string | null;
  invoice_series: string | null;
  invoice_key: string | null;
  authorization_protocol: string | null;
  issued_at: string | null;
  authorized_at: string | null;
  ml_sync_status: string | null;
  danfe_available: boolean;
  xml_available: boolean;
  error_code: string | null;
  error_message: string | null;
  note: string;
  danfe_view_url: string | null;
  danfe_download_url: string | null;
  danfe_print_url: string | null;
  xml_view_url: string | null;
  xml_download_url: string | null;
  updated_at: string | null;
}

export interface MLNFeResponse {
  status: string;
  action?: string;
  sync_action?: string;
  nfe: MLNFeDocument;
  readiness?: MLNFeReadiness;
}

const ML_REMOTE_TIMEOUT_MS = 8000;
const ML_ORDERS_TIMEOUT_MS = 30000;
const ML_SYNC_TIMEOUT_MS = 120000; // 2min — sync full pode puxar muitas paginas
const ML_DASHBOARD_TIMEOUT_MS = 45000;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
  timeoutMs = ML_REMOTE_TIMEOUT_MS
): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      credentials: "include",
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { response, data };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatSaleDate(dateString: string): { saleDate: string; saleTime: string } {
  const parsedDate = new Date(dateString);

  if (Number.isNaN(parsedDate.getTime())) {
    return { saleDate: "", saleTime: "" };
  }

  return {
    saleDate: `${parsedDate.getFullYear()}-${padDatePart(parsedDate.getMonth() + 1)}-${padDatePart(parsedDate.getDate())}`,
    saleTime: `${padDatePart(parsedDate.getHours())}:${padDatePart(parsedDate.getMinutes())}`,
  };
}

// Extrai sla_snapshot.expected_date do raw_data do ML e formata como
// DD/MM/YYYY pra exibir direto na etiqueta interna Ecoferro ("Data Envio").
function extractExpectedShippingDate(order: MLOrder): string {
  const raw = (order.raw_data as { sla_snapshot?: { expected_date?: string } } | null | undefined);
  const iso = raw?.sla_snapshot?.expected_date;
  if (!iso || typeof iso !== "string") return "";
  // Aceita formatos "YYYY-MM-DD" ou ISO completo. Pega YYYY-MM-DD do início.
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

// Extrai a variação de um item do pedido ML.
// F-M6: extractVariationFromRawItem movido pra mercadoLivreHelpers.ts
// (era duplicado em separationReportService.ts).
import { extractVariationFromRawItem } from "./mercadoLivreHelpers";

export function mapMLOrderToSaleData(order: MLOrder) {
  const { saleDate, saleTime } = formatSaleDate(order.sale_date);
  const primaryItem = order.items?.[0];
  const rawData = order.raw_data as { order_items?: unknown[] } | null | undefined;
  const rawOrderItems: Array<Record<string, unknown>> = Array.isArray(rawData?.order_items)
    ? (rawData.order_items as Array<Record<string, unknown>>)
    : [];
  const groupedItems: SaleItemData[] = (order.items || []).map((item, idx) => {
    const rawItem = rawOrderItems[idx];
    const variation =
      item.variation ||
      extractVariationFromRawItem(rawItem) ||
      null;
    return {
      itemTitle: item.item_title || "Produto sem titulo",
      sku: item.sku || "",
      quantity: item.quantity || 1,
      amount: item.amount ?? undefined,
      productImageUrl: item.product_image_url || undefined,
      productImageData: "",
      variation,
    };
  });
  const sku = order.sku || primaryItem?.sku || "";
  const productName =
    groupedItems.length > 1
      ? `Pacote com ${groupedItems.length} produtos`
      : order.item_title ||
        primaryItem?.item_title ||
        order.items
          ?.map((item) => item.item_title)
          .filter((title): title is string => Boolean(title))
          .join(" | ") ||
        "";
  const productImageUrl =
    order.product_image_url || primaryItem?.product_image_url || "";

  // Variação do primeiro item (se houver) → vai no topo do SaleData também
  const topVariation = groupedItems[0]?.variation || null;

  // Deposit label pra etiqueta interna: "FULL" / "Ourinhos Rua Dario
  // Alonso" / "Sem depósito" — deixa o operador distinguir visualmente
  // o canal logistico na hora de separar/enviar.
  const depositInfo = getDepositInfo(order);
  const depositLabel = depositInfo.isFulfillment
    ? "FULL"
    : depositInfo.hasDeposit
      ? depositInfo.label
      : "Sem depósito";

  return {
    id: order.id,
    saleNumber: order.sale_number || order.order_id,
    saleDate,
    saleTime,
    customerName: order.buyer_name || "",
    customerNickname: order.buyer_nickname || "",
    productName,
    sku,
    quantity: order.quantity || 1,
    amount: order.amount ?? undefined,
    barcodeValue: sku,
    qrcodeValue: sku,
    saleQrcodeValue: order.sale_number || order.order_id,
    productImageUrl,
    productImageData: "",
    labelObservation: "",
    groupedItems,
    variation: topVariation,
    depositLabel,
    expectedShippingDate: extractExpectedShippingDate(order),
  };
}

// Retorna o pack_id de um order (se existir)
export function getOrderPackId(order: MLOrder): string | null {
  const raw = (order.raw_data as { pack_id?: unknown } | null | undefined) || {};
  const pid = raw.pack_id;
  return pid ? String(pid) : null;
}

// Encontra todos os orders do mesmo pack. Se o order não tem pack, retorna só ele.
export function findOrdersInSamePack(
  targetOrder: MLOrder,
  allOrders: MLOrder[]
): MLOrder[] {
  const packId = getOrderPackId(targetOrder);
  if (!packId) return [targetOrder];
  const same = allOrders.filter((o) => getOrderPackId(o) === packId);
  return same.length > 0 ? same : [targetOrder];
}

// Brief 2026-04-29: agrupamento por COMPRADOR (sem pack_id). Quando o
// mesmo buyer compra multiplas vendas separadas com mesmo prazo de
// envio, consolida tudo numa etiqueta unica pra simplificar a expedicao.
//
// Criterios pra unificar (TODOS precisam bater):
//   - mesmo buyer_name (case-insensitive)
//   - mesmo buyer_nickname (case-insensitive)
//   - mesma expected_shipping_date (so a parte da data, ignora hora)
//   - NENHUM tem pack_id (orders com pack ja sao agrupados por pack)
//
// Status divergente NAO bloqueia o agrupamento — operador imprime tudo
// e separa fisicamente. Para nao agrupar status divergente, filtre
// antes de chamar essa funcao.
function normalizeBuyerKey(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

function getOrderShippingDateKey(order: MLOrder): string {
  // Usa expectedShippingDate quando disponivel, senao fallback pra
  // sale_date (ambos como YYYY-MM-DD pra agrupamento por dia).
  const expected = extractExpectedShippingDate(order);
  if (expected) return expected.slice(0, 10);
  return (order.sale_date || "").slice(0, 10);
}

export function findOrdersForSameBuyer(
  targetOrder: MLOrder,
  allOrders: MLOrder[]
): MLOrder[] {
  // Se ja tem pack, deixa o pack-grouping cuidar — nao mistura logicas.
  if (getOrderPackId(targetOrder)) return [targetOrder];

  const targetName = normalizeBuyerKey(targetOrder.buyer_name);
  const targetNick = normalizeBuyerKey(targetOrder.buyer_nickname);
  const targetShipKey = getOrderShippingDateKey(targetOrder);

  // Buyer "anonimo" (sem nome E sem nick) nao agrupa — risco de
  // misturar pedidos de pessoas diferentes.
  if (!targetName && !targetNick) return [targetOrder];

  const same = allOrders.filter((o) => {
    if (getOrderPackId(o)) return false;
    if (normalizeBuyerKey(o.buyer_name) !== targetName) return false;
    if (normalizeBuyerKey(o.buyer_nickname) !== targetNick) return false;
    if (getOrderShippingDateKey(o) !== targetShipKey) return false;
    return true;
  });

  return same.length > 0 ? same : [targetOrder];
}

// Unifica orders do MESMO comprador (sem pack) em uma unica SaleData.
// Mesma logica de mapUnifiedPackSaleData mas usa "+N" no saleNumber
// para nao explodir o footer da etiqueta com IDs gigantes concatenados.
export function mapUnifiedBuyerSaleData(orders: MLOrder[]): ReturnType<typeof mapMLOrderToSaleData> {
  if (orders.length === 0) throw new Error("Nenhum pedido para unificar");
  if (orders.length === 1) return mapMLOrderToSaleData(orders[0]);

  const base = orders[0];
  const baseSale = mapMLOrderToSaleData(base);

  const allGroupedItems: SaleItemData[] = [];
  const allSaleNumbers: string[] = [];

  for (const order of orders) {
    const sale = mapMLOrderToSaleData(order);
    allGroupedItems.push(...(sale.groupedItems || []));
    const num = order.sale_number || order.order_id;
    if (num) allSaleNumbers.push(num);
  }

  const unifiedMap = new Map<string, SaleItemData>();
  for (const item of allGroupedItems) {
    const key = `${item.sku || item.itemTitle}::${item.variation || ""}`;
    const existing = unifiedMap.get(key);
    if (existing) {
      existing.quantity += item.quantity || 1;
      existing.amount = (existing.amount || 0) + (item.amount || 0);
    } else {
      unifiedMap.set(key, { ...item });
    }
  }
  const unifiedItems = Array.from(unifiedMap.values());

  // saleNumber compacto: "<primeiro> +N" pra caber no footer (CARD_W
  // tem ~38mm de largura na coluna esquerda). Ex: "2000016102974372 +2".
  const firstNumber = allSaleNumbers[0] || baseSale.saleNumber || "";
  const extras = allSaleNumbers.length - 1;
  const compactSaleNumber = extras > 0 ? `${firstNumber} +${extras}` : firstNumber;

  return {
    ...baseSale,
    saleNumber: compactSaleNumber,
    saleQrcodeValue: firstNumber, // QR aponta pra primeira venda
    productName: unifiedItems.length > 1
      ? `Pacote com ${unifiedItems.length} produtos`
      : unifiedItems[0]?.itemTitle || baseSale.productName,
    sku: unifiedItems[0]?.sku || baseSale.sku,
    quantity: unifiedItems.reduce((sum, i) => sum + (i.quantity || 1), 0),
    groupedItems: unifiedItems,
  };
}

// Unifica múltiplos orders do MESMO pack em uma única SaleData.
// Todos os items dos pedidos viram groupedItems da mesma etiqueta.
// Mantém dados do buyer (comprador) — nunca do receiver.
export function mapUnifiedPackSaleData(orders: MLOrder[]): ReturnType<typeof mapMLOrderToSaleData> {
  if (orders.length === 0) throw new Error("Nenhum pedido para unificar");
  if (orders.length === 1) return mapMLOrderToSaleData(orders[0]);

  // Usa o primeiro order como base (buyer, data, etc.)
  const base = orders[0];
  const baseSale = mapMLOrderToSaleData(base);

  // Junta todos os items de todos os orders
  const allGroupedItems: SaleItemData[] = [];
  const allSaleNumbers: string[] = [];

  for (const order of orders) {
    const sale = mapMLOrderToSaleData(order);
    allGroupedItems.push(...(sale.groupedItems || []));
    const num = order.sale_number || order.order_id;
    if (num) allSaleNumbers.push(num);
  }

  // Deduplicar items por SKU+variação (somando quantidades)
  const unifiedMap = new Map<string, SaleItemData>();
  for (const item of allGroupedItems) {
    const key = `${item.sku || item.itemTitle}::${item.variation || ""}`;
    const existing = unifiedMap.get(key);
    if (existing) {
      existing.quantity += item.quantity || 1;
      existing.amount = (existing.amount || 0) + (item.amount || 0);
    } else {
      unifiedMap.set(key, { ...item });
    }
  }
  const unifiedItems = Array.from(unifiedMap.values());

  // Sale number = o pack_id ou todos concatenados
  const packId = getOrderPackId(base) || allSaleNumbers.join(" + ");

  return {
    ...baseSale,
    saleNumber: packId,
    saleQrcodeValue: packId,
    productName: unifiedItems.length > 1
      ? `Pacote com ${unifiedItems.length} produtos`
      : unifiedItems[0]?.itemTitle || baseSale.productName,
    sku: unifiedItems[0]?.sku || baseSale.sku,
    quantity: unifiedItems.reduce((sum, i) => sum + (i.quantity || 1), 0),
    groupedItems: unifiedItems,
  };
}

export function mapMLOrderToProcessingResult(order: MLOrder): ProcessingResult {
  const { saleDate, saleTime } = formatSaleDate(order.sale_date);
  const sku = order.sku || order.items?.[0]?.sku || "";
  const productName =
    (order.items?.length || 0) > 1
      ? `Pacote com ${order.items?.length} produtos`
      : order.item_title || order.items?.[0]?.item_title || "";
  return {
    sale: mapMLOrderToSaleData(order),
    mlOrderIds: [order.order_id],
    rawText: JSON.stringify(
      {
        order_id: order.order_id,
        status: order.order_status,
        buyer_name: order.buyer_name,
        buyer_nickname: order.buyer_nickname,
        item_title: order.item_title,
        sku: order.sku,
        product_image_url: order.product_image_url,
        quantity: order.quantity,
        amount: order.amount,
        items: order.items,
        sale_date: order.sale_date,
        billing_info_status:
          order.raw_data && typeof order.raw_data === "object"
            ? (order.raw_data.billing_info_status ?? null)
            : null,
      },
      null,
      2
    ),
    confidence: {
      saleNumber: order.sale_number ? "high" : "medium",
      saleDate: saleDate ? "high" : "empty",
      saleTime: saleTime ? "high" : "empty",
      customerName: order.buyer_name ? "high" : "low",
      customerNickname: order.buyer_nickname ? "high" : "low",
      productName: productName ? "high" : "empty",
      sku: sku ? "high" : "low",
      quantity: "high",
      amount: order.amount != null ? "high" : "empty",
      barcodeValue: sku ? "high" : "low",
      qrcodeValue: sku ? "high" : "low",
    },
    method: "mercado-livre",
  };
}

export function mapMLOrdersToProcessingResults(orders: MLOrder[]): ProcessingResult[] {
  // Agrupa orders pelo pack_id e gera 1 ProcessingResult por pack.
  // Orders sem pack_id continuam individuais.
  const packMap = new Map<string, MLOrder[]>();
  const standalone: MLOrder[] = [];

  for (const order of orders) {
    const packId = getOrderPackId(order);
    if (packId) {
      const existing = packMap.get(packId);
      if (existing) existing.push(order);
      else packMap.set(packId, [order]);
    } else {
      standalone.push(order);
    }
  }

  const results: ProcessingResult[] = [];

  // Orders com pack → 1 SaleData unificada por pack
  for (const [, packOrders] of packMap) {
    if (packOrders.length === 1) {
      results.push(mapMLOrderToProcessingResult(packOrders[0]));
    } else {
      const unifiedSale = mapUnifiedPackSaleData(packOrders);
      const base = packOrders[0];
      results.push({
        sale: unifiedSale,
        rawText: JSON.stringify({
          pack_id: getOrderPackId(base),
          unified_orders: packOrders.map((o) => o.order_id),
        }),
        confidence: {
          saleNumber: 1,
          saleDate: 1,
          saleTime: 1,
          customerName: 1,
          customerNickname: 1,
          productName: 1,
          sku: 1,
          quantity: 1,
        },
        method: "mercado-livre",
        // Todos os orders do pack para marcacao em bloco apos impressao
        mlOrderIds: packOrders.map((o) => o.order_id),
      });
    }
  }

  // Orders sem pack → 1 SaleData por order
  for (const order of standalone) {
    results.push(mapMLOrderToProcessingResult(order));
  }

  return results;
}

async function parseErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string; details?: string; message?: string }
    | null;

  return data?.details || data?.error || data?.message || fallbackMessage;
}

export async function getMLConnectionStatus(): Promise<MLConnection | null> {
  const { response, data } = await fetchJsonWithTimeout<{ connection?: MLConnection | null; error?: string }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "status" }),
    },
    "Timeout ao consultar o status da conexao do Mercado Livre."
  );

  if (!response.ok) {
    throw new Error(data?.error || "Nao foi possivel consultar a conexao do Mercado Livre.");
  }

  return data?.connection ?? null;
}

/**
 * Brief 2026-04-28 multi-seller fase 2: lista todas as conexoes
 * (EcoFerro + Fantom + futuras) pra UI escolher escopo.
 */
export async function listMLConnections(): Promise<MLConnection[]> {
  const { response, data } = await fetchJsonWithTimeout<{
    connections?: MLConnection[];
    error?: string;
  }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    },
    "Timeout ao listar conexoes do Mercado Livre."
  );

  if (!response.ok) {
    throw new Error(data?.error || "Nao foi possivel listar conexoes.");
  }

  return Array.isArray(data?.connections) ? data.connections : [];
}

export async function startMLOAuth(): Promise<string> {
  const { redirectUri, state, codeChallenge } = await createMLOAuthSession();
  const { response, data } = await fetchJsonWithTimeout<{ url?: string; error?: string }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "get_auth_url",
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }),
    },
    "Timeout ao iniciar a conexao com o Mercado Livre."
  );

  if (!response.ok || !data?.url) {
    throw new Error(data?.error || "Nao foi possivel iniciar a conexao com o Mercado Livre.");
  }

  return data.url;
}

export async function exchangeMLCode(params: {
  code: string;
  state: string;
  redirectUri?: string;
  codeVerifier?: string;
}): Promise<MLConnection> {
  const redirectUri = params.redirectUri || resolveMLRedirectUri();
  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    connection?: MLConnection;
    error?: string;
    details?: string;
  }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "exchange_code",
        code: params.code,
        state: params.state,
        redirect_uri: redirectUri,
        code_verifier: params.codeVerifier,
      }),
    },
    "Timeout ao concluir a conexao com o Mercado Livre."
  );

  if (!response.ok || !data?.success || !data.connection) {
    throw new Error(data?.details || data?.error || "Nao foi possivel concluir a conexao com o Mercado Livre.");
  }

  return data.connection;
}

export async function syncMLOrders(
  connectionId: string,
  filters?: {
    date_from?: string;
    date_to?: string;
    status_filter?: string;
    updated_from?: string;
  }
): Promise<{
  total_fetched: number;
  synced: number;
  skipped: boolean;
  connection_last_sync_at: string | null;
}> {
  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    total_fetched?: number;
    synced?: number;
    skipped?: boolean;
    connection_last_sync_at?: string | null;
    error?: string;
  }>(
    "/api/ml/sync",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ connection_id: connectionId, ...filters }),
    },
    "Timeout ao sincronizar os pedidos do Mercado Livre.",
    ML_SYNC_TIMEOUT_MS
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao sincronizar os pedidos do Mercado Livre.");
  }

  return {
    total_fetched: Number(data.total_fetched || 0),
    synced: Number(data.synced || 0),
    skipped: Boolean(data.skipped),
    connection_last_sync_at:
      typeof data.connection_last_sync_at === "string"
        ? data.connection_last_sync_at
        : null,
  };
}

export async function disconnectML(connectionId: string): Promise<void> {
  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    error?: string;
  }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "disconnect",
        connection_id: connectionId,
      }),
    },
    "Timeout ao desconectar a conta do Mercado Livre."
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao desconectar a conta do Mercado Livre.");
  }
}

interface GetMLOrdersOptions {
  scope?: "all" | "operational";
  limit?: number | null;
  offset?: number;
  view?: "full" | "dashboard";
  /** Brief 2026-04-28 multi-seller fase 2: filtra pedidos por
   * conexao ML (EcoFerro vs Fantom). Quando ausente, retorna todos. */
  connectionId?: string | null;
}

export async function getMLOrdersPage(
  options: GetMLOrdersOptions = {}
): Promise<MLOrdersResponse> {
  const params = new URLSearchParams();

  if (options.scope && options.scope !== "all") {
    params.set("scope", options.scope);
  }

  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.trunc(options.limit)));
  }

  if (typeof options.offset === "number" && Number.isFinite(options.offset) && options.offset > 0) {
    params.set("offset", String(Math.trunc(options.offset)));
  }

  if (options.view && options.view !== "full") {
    params.set("view", options.view);
  }

  if (options.connectionId) {
    params.set("connection_id", options.connectionId);
  }

  const url = params.size > 0 ? `/api/ml/orders?${params.toString()}` : "/api/ml/orders";
  const { response, data } = await fetchJsonWithTimeout<{
    orders?: MLOrder[];
    pagination?: Partial<MLOrdersPagination>;
    error?: string;
  }>(
    url,
    {},
    "Timeout ao carregar os pedidos do Mercado Livre.",
    ML_ORDERS_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar os pedidos do Mercado Livre.");
  }

  const orders = Array.isArray(data?.orders)
    ? data.orders.map((order) => ({
        ...order,
        items: Array.isArray(order.items) ? order.items : [],
      }))
    : [];

  const safeLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
      ? Math.trunc(options.limit)
      : orders.length;
  const safeOffset =
    typeof options.offset === "number" && Number.isFinite(options.offset) && options.offset > 0
      ? Math.trunc(options.offset)
      : 0;

  return {
    orders,
    pagination: {
      offset:
        typeof data?.pagination?.offset === "number" ? data.pagination.offset : safeOffset,
      limit: typeof data?.pagination?.limit === "number" ? data.pagination.limit : safeLimit,
      total: typeof data?.pagination?.total === "number" ? data.pagination.total : orders.length,
      loaded:
        typeof data?.pagination?.loaded === "number" ? data.pagination.loaded : orders.length,
      has_more: Boolean(data?.pagination?.has_more),
      next_offset:
        typeof data?.pagination?.next_offset === "number"
          ? data.pagination.next_offset
          : null,
    },
  };
}

export async function getMLOrders(options: GetMLOrdersOptions = {}): Promise<MLOrder[]> {
  const response = await getMLOrdersPage(options);
  return response.orders;
}

export async function getMLDashboard(
  options: { connectionId?: string | null } = {}
): Promise<MLDashboardResponse> {
  const url = options.connectionId
    ? `/api/ml/dashboard?connection_id=${encodeURIComponent(options.connectionId)}`
    : "/api/ml/dashboard";
  const { response, data } = await fetchJsonWithTimeout<{
    backend_secure?: boolean;
    generated_at?: string;
    internal_operational?: MLDashboardCountLayer;
    seller_center_mirror?: MLDashboardMirrorLayer;
    post_sale_overview?: MLDashboardPostSaleOverview;
    operational_queues?: MLDashboardOperationalQueues;
    deposits?: MLDashboardDeposit[];
    ml_ui_chip_counts?: MLLiveChipCounts | null;
    ml_ui_chip_counts_stale?: boolean;
    ml_ui_chip_counts_age_seconds?: number | null;
    ml_live_chip_counts?: MLLiveChipCounts;
    ml_live_chip_order_ids_by_bucket?: MLLiveChipOrderIdsByBucket;
    error?: string;
  }>(
    url,
    {},
    "Timeout ao carregar o painel operacional do Mercado Livre.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, data?.error || "Falha ao carregar o dashboard."));
  }

  return {
    backend_secure: Boolean(data?.backend_secure),
    generated_at:
      typeof data?.generated_at === "string" ? data.generated_at : new Date().toISOString(),
    internal_operational: data?.internal_operational,
    seller_center_mirror: data?.seller_center_mirror,
    post_sale_overview: data?.post_sale_overview,
    operational_queues: data?.operational_queues,
    deposits: Array.isArray(data?.deposits) ? data.deposits : [],
    ml_ui_chip_counts: data?.ml_ui_chip_counts ?? null,
    ml_ui_chip_counts_stale: Boolean(data?.ml_ui_chip_counts_stale),
    ml_ui_chip_counts_age_seconds: data?.ml_ui_chip_counts_age_seconds ?? null,
    ml_live_chip_counts: data?.ml_live_chip_counts,
    ml_live_chip_order_ids_by_bucket: data?.ml_live_chip_order_ids_by_bucket,
  };
}

export async function getMLPrivateSellerCenterComparison(): Promise<MLPrivateSellerCenterComparisonResponse> {
  const { response, data } = await fetchJsonWithTimeout<{
    status?: string;
    generated_at?: string;
    connection_id?: string | null;
    seller_id?: string | null;
    snapshot_status?: MLPrivateSellerCenterSnapshotStatus;
    internal_operational?: MLDashboardCountLayer | null;
    seller_center_mirror?: MLDashboardMirrorLayer | null;
    views?: MLPrivateSellerCenterComparisonView[];
    error?: string;
  }>(
    "/api/ml/private-seller-center-comparison",
    {},
    "Timeout ao carregar a comparação técnica do Seller Center.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        data?.error || "Falha ao carregar a comparação do Seller Center."
      )
    );
  }

  return {
    status: data?.status || "ok",
    generated_at:
      typeof data?.generated_at === "string" ? data.generated_at : new Date().toISOString(),
    connection_id: data?.connection_id ?? null,
    seller_id: data?.seller_id ?? null,
    snapshot_status: data?.snapshot_status || {
      status: "missing",
      total_snapshots: 0,
      last_captured_at: null,
    },
    internal_operational: data?.internal_operational ?? null,
    seller_center_mirror: data?.seller_center_mirror ?? null,
    views: Array.isArray(data?.views) ? data.views : [],
  };
}

export interface MLStockItem {
  item_id: string;
  sku: string | null;
  title: string | null;
  available_quantity: number;
  sold_quantity: number;
  total_quantity: number;
  status: string | null;
  condition: string | null;
  listing_type: string | null;
  price: number | null;
  thumbnail: string | null;
  brand: string | null;
  model: string | null;
  vehicle_year: string | null;
  synced_at: string;
  location_corridor?: string | null;
  location_shelf?: string | null;
  location_level?: string | null;
  location_notes?: string | null;
  /**
   * Agregados de vendas recentes vindos do cruzamento de ml_stock com
   * ml_orders no backend. Period controlado via parametro sales_period
   * na query do GET /api/ml/stock.
   * recent_sales_qty conta UNIDADES (pedido com 3 un soma 3).
   * recent_sales_orders conta PEDIDOS unicos.
   */
  recent_sales_qty?: number;
  recent_sales_orders?: number;
  last_sale_date?: string | null;
}

export type StockSalesPeriod = "7d" | "30d" | "90d" | "all" | "custom";

export interface StockCustomRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export async function updateMLStockItem(
  connectionId: string,
  itemId: string,
  updates: Partial<Pick<MLStockItem, "sku" | "title" | "location_corridor" | "location_shelf" | "location_level" | "location_notes">>
): Promise<void> {
  const { response, data } = await fetchJsonWithTimeout<{ success?: boolean; error?: string }>(
    `/api/ml/stock?connection_id=${encodeURIComponent(connectionId)}&item_id=${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
    "Timeout ao atualizar produto.",
    15000
  );
  if (!response.ok) throw new Error(data?.error || "Falha ao atualizar produto.");
}

export async function deleteMLStockItem(connectionId: string, itemId: string): Promise<void> {
  const { response, data } = await fetchJsonWithTimeout<{ success?: boolean; error?: string }>(
    `/api/ml/stock?connection_id=${encodeURIComponent(connectionId)}&item_id=${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
    "Timeout ao excluir produto.",
    15000
  );
  if (!response.ok) throw new Error(data?.error || "Falha ao excluir produto.");
}

export interface StockLocation {
  corridor: string | null;
  shelf: string | null;
  level: string | null;
  notes: string | null;
}

// Busca localizações de vários SKUs de uma vez. Retorna mapa { sku → location }.
export async function getStockLocations(
  connectionId: string,
  skus: string[]
): Promise<Record<string, StockLocation>> {
  const cleanSkus = skus.filter(Boolean);
  if (cleanSkus.length === 0) return {};

  const { response, data } = await fetchJsonWithTimeout<{
    locations?: Record<string, StockLocation>;
    error?: string;
  }>(
    `/api/ml/stock?connection_id=${encodeURIComponent(connectionId)}&skus=${encodeURIComponent(cleanSkus.join(","))}`,
    {},
    "Timeout ao buscar localização dos produtos.",
    10000
  );

  if (!response.ok) return {};
  return data?.locations || {};
}

export async function getMLStock(
  connectionId: string,
  options: {
    salesPeriod?: StockSalesPeriod;
    customRange?: StockCustomRange;
  } = {}
): Promise<{
  items: MLStockItem[];
  stale: boolean;
  salesPeriod: StockSalesPeriod;
  customRange: StockCustomRange | null;
}> {
  const salesPeriod = options.salesPeriod || "30d";
  const params = new URLSearchParams({
    connection_id: connectionId,
    sales_period: salesPeriod,
  });
  if (salesPeriod === "custom" && options.customRange) {
    params.set("start_date", options.customRange.from);
    params.set("end_date", options.customRange.to);
  }

  const { response, data } = await fetchJsonWithTimeout<{
    items?: MLStockItem[];
    stale?: boolean;
    sales_period?: string;
    sales_period_range?: StockCustomRange | null;
    error?: string;
  }>(
    `/api/ml/stock?${params.toString()}`,
    {},
    "Timeout ao carregar o estoque do Mercado Livre.",
    30000
  );

  if (!response.ok) {
    throw new Error(data?.error || "Falha ao carregar o estoque.");
  }

  return {
    items: Array.isArray(data?.items) ? data.items : [],
    stale: Boolean(data?.stale),
    salesPeriod: (data?.sales_period as StockSalesPeriod) || salesPeriod,
    customRange: data?.sales_period_range ?? null,
  };
}

export async function syncMLStock(connectionId: string): Promise<{ total_synced: number }> {
  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    total_synced?: number;
    error?: string;
  }>(
    `/api/ml/stock?connection_id=${encodeURIComponent(connectionId)}`,
    { method: "POST" },
    "Timeout ao sincronizar o estoque do Mercado Livre.",
    120000
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao sincronizar o estoque.");
  }

  return { total_synced: Number(data?.total_synced || 0) };
}

export async function syncStockToWebsite(): Promise<{
  created: number;
  updated: number;
  errors: number;
  total: number;
}> {
  const { response, data } = await fetchJsonWithTimeout<{
    success: boolean;
    created: number;
    updated: number;
    errors: number;
    total: number;
    error?: string;
  }>(
    "/api/ml/sync-to-website",
    { method: "POST" },
    "Timeout ao sincronizar com o site.",
    120000,
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao sincronizar com o site.");
  }

  return {
    created: data.created || 0,
    updated: data.updated || 0,
    errors: data.errors || 0,
    total: data.total || 0,
  };
}

/**
 * Marca uma lista de pedidos como "etiqueta impressa" (timestamp = agora).
 * A UI chama isso automaticamente apos baixar o PDF de etiquetas em lote
 * (ReviewPage.handleBatchExport) ou individual (handleExport).
 * Retorna a quantidade de linhas afetadas no banco.
 */
export async function markLabelsAsPrinted(orderIds: string[]): Promise<number> {
  const cleanIds = Array.from(
    new Set(
      (orderIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  if (cleanIds.length === 0) return 0;

  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    affected?: number;
    error?: string;
  }>(
    "/api/ml/labels/mark-printed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: cleanIds }),
    },
    "Timeout ao marcar etiquetas como impressas.",
    15000
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao marcar etiquetas como impressas.");
  }

  return Number(data?.affected || 0);
}

/**
 * Desmarca uma lista de pedidos (seta label_printed_at = null), devolvendo-os
 * para a fila de "sem etiqueta impressa". Util quando o operador precisa
 * reimprimir ou marcou errado.
 */
export async function markLabelsAsUnprinted(orderIds: string[]): Promise<number> {
  const cleanIds = Array.from(
    new Set(
      (orderIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  if (cleanIds.length === 0) return 0;

  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    affected?: number;
    error?: string;
  }>(
    "/api/ml/labels/mark-unprinted",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: cleanIds }),
    },
    "Timeout ao desmarcar etiquetas.",
    15000
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || "Falha ao desmarcar etiquetas.");
  }

  return Number(data?.affected || 0);
}

export async function getMLOrderDocuments(
  orderId: string,
  options: { refresh?: boolean } = {}
): Promise<MLOrderDocumentsResponse> {
  const params = new URLSearchParams({
    order_id: orderId,
  });

  if (options.refresh) {
    params.set("refresh", "1");
  }

  const { response, data } = await fetchJsonWithTimeout<
    MLOrderDocumentsResponse & { error?: string }
  >(
    `/api/ml/order-documents?${params.toString()}`,
    {},
    "Timeout ao carregar os documentos operacionais externos.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        data?.error || "Falha ao carregar os documentos operacionais."
      )
    );
  }

  return {
    status: data?.status || "ok",
    order_id: data?.order_id || orderId,
    shipment_id: data?.shipment_id ?? null,
    pack_id: data?.pack_id ?? null,
    seller_id: data?.seller_id ?? null,
    internal_label_existing: data?.internal_label_existing || {
      status: "available",
      flow: "review_pdf_export",
      note: "",
      route: "/review",
      order_id: orderId,
    },
    shipping_label_external: data?.shipping_label_external || {
      status: "unavailable",
      source: "mercado_livre_shipment_labels",
      fetched_at: null,
      label_format: null,
      note: "Etiqueta externa não disponível.",
      view_url: null,
      download_url: null,
      print_url: null,
    },
    invoice_nfe_document: data?.invoice_nfe_document || {
      status: "unavailable",
      source: "mercado_livre_invoices_order",
      fetched_at: null,
      invoice_number: null,
      invoice_key: null,
      danfe_available: false,
      xml_available: false,
      note: "NF-e não disponível.",
      danfe_view_url: null,
      danfe_download_url: null,
      danfe_print_url: null,
      xml_view_url: null,
      xml_download_url: null,
    },
  };
}

export function getMLOrderDocumentFileUrl(
  orderId: string,
  options: {
    type: "shipping_label_external" | "invoice_nfe_document";
    variant?: "danfe" | "xml";
    disposition?: "inline" | "attachment";
    refresh?: boolean;
  }
): string {
  const params = new URLSearchParams({
    order_id: orderId,
    type: options.type,
  });

  if (options.variant) {
    params.set("variant", options.variant);
  }

  if (options.disposition) {
    params.set("disposition", options.disposition);
  }

  if (options.refresh) {
    params.set("refresh", "1");
  }

  return `/api/ml/order-documents/file?${params.toString()}`;
}

export async function getMLNFeDocument(
  orderId: string,
  options: { refresh?: boolean } = {}
): Promise<MLNFeResponse> {
  const params = new URLSearchParams({
    order_id: orderId,
  });

  if (options.refresh) {
    params.set("refresh", "1");
  }

  const { response, data } = await fetchJsonWithTimeout<MLNFeResponse & { error?: string }>(
    `/api/nfe/document?${params.toString()}`,
    {},
    "Timeout ao consultar a NF-e.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, data?.error || "Falha ao consultar a NF-e."));
  }

  return data as MLNFeResponse;
}

export async function generateMLNFe(orderId: string): Promise<MLNFeResponse> {
  const { response, data } = await fetchJsonWithTimeout<MLNFeResponse & { error?: string }>(
    "/api/nfe/generate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId }),
    },
    "Timeout ao solicitar a emissão da NF-e.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, data?.error || "Falha ao gerar a NF-e."));
  }

  return data as MLNFeResponse;
}

export async function syncMLNFeWithMercadoLivre(orderId: string): Promise<MLNFeResponse> {
  const { response, data } = await fetchJsonWithTimeout<MLNFeResponse & { error?: string }>(
    "/api/nfe/sync-mercadolivre",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId }),
    },
    "Timeout ao sincronizar a NF-e com o Mercado Livre.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, data?.error || "Falha ao sincronizar a NF-e com o Mercado Livre.")
    );
  }

  return data as MLNFeResponse;
}

export function getMLNFeFileUrl(
  orderId: string,
  options: {
    variant: "danfe" | "xml";
    disposition?: "inline" | "attachment";
    refresh?: boolean;
  }
): string {
  const params = new URLSearchParams({
    order_id: orderId,
    variant: options.variant,
  });

  if (options.disposition) {
    params.set("disposition", options.disposition);
  }

  if (options.refresh) {
    params.set("refresh", "1");
  }

  return `/api/nfe/file?${params.toString()}`;
}

export interface MLConferenciaItemInfo {
  title: string | null;
  permalink: string | null;
}

export interface MLConferenciaResponse {
  order: MLOrder;
  pictures: Record<string, string[]>;
  items: Record<string, MLConferenciaItemInfo>;
  has_ml_connection: boolean;
}

/**
 * Busca uma venda pelo codigo lido no leitor USB (QR/barcode).
 *
 * O codigo e' normalmente o `sale_number` (QR impresso pelo proprio sistema
 * via SaleCardPreview), mas tambem aceita `order_id` puro. Retorna tambem
 * as fotos do anuncio ML e o permalink, pra mostrar referencia visual na
 * tela de conferencia e reduzir erros de separacao de pedidos.
 */
export async function getConferenciaSale(code: string): Promise<MLConferenciaResponse> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Codigo invalido.");
  }

  const { response, data } = await fetchJsonWithTimeout<
    MLConferenciaResponse & { error?: string }
  >(
    `/api/ml/conferencia?code=${encodeURIComponent(normalizedCode)}`,
    {},
    "Timeout ao buscar a venda para conferencia.",
    ML_DASHBOARD_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, data?.error || "Falha ao buscar a venda.")
    );
  }

  if (!data?.order) {
    throw new Error("Venda nao encontrada.");
  }

  return {
    order: data.order,
    pictures: data.pictures || {},
    items: data.items || {},
    has_ml_connection: Boolean(data.has_ml_connection),
  };
}
