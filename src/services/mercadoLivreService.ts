import {
  createMLOAuthSession,
  resolveMLRedirectUri,
} from "@/services/mlOAuth";
import type { ProcessingResult } from "@/services/fileProcessor";
import type { SaleItemData } from "@/types/sales";

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
}

export interface MLOrderItem {
  item_title: string | null;
  sku: string | null;
  quantity: number;
  amount: number | null;
  item_id?: string | null;
  product_image_url?: string | null;
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

export type MLOperationalBucket = "today" | "upcoming" | "in_transit" | "finalized";

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

export interface MLDashboardResponse {
  backend_secure: boolean;
  generated_at: string;
  internal_operational?: MLDashboardCountLayer;
  seller_center_mirror?: MLDashboardMirrorLayer;
  post_sale_overview?: MLDashboardPostSaleOverview;
  operational_queues?: MLDashboardOperationalQueues;
  deposits: MLDashboardDeposit[];
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
const ML_SYNC_TIMEOUT_MS = 30000;
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

export function mapMLOrderToProcessingResult(order: MLOrder): ProcessingResult {
  const { saleDate, saleTime } = formatSaleDate(order.sale_date);
  const primaryItem = order.items?.[0];
  const groupedItems: SaleItemData[] = (order.items || []).map((item) => ({
    itemTitle: item.item_title || "Produto sem titulo",
    sku: item.sku || "",
    quantity: item.quantity || 1,
    amount: item.amount ?? undefined,
    productImageUrl: item.product_image_url || undefined,
    productImageData: "",
  }));
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

  return {
    sale: {
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
    },
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
  return orders.map(mapMLOrderToProcessingResult);
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

export async function getMLDashboard(): Promise<MLDashboardResponse> {
  const { response, data } = await fetchJsonWithTimeout<{
    backend_secure?: boolean;
    generated_at?: string;
    internal_operational?: MLDashboardCountLayer;
    seller_center_mirror?: MLDashboardMirrorLayer;
    post_sale_overview?: MLDashboardPostSaleOverview;
    operational_queues?: MLDashboardOperationalQueues;
    deposits?: MLDashboardDeposit[];
    error?: string;
  }>(
    "/api/ml/dashboard",
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
}

export async function getMLStock(connectionId: string): Promise<{ items: MLStockItem[]; stale: boolean }> {
  const { response, data } = await fetchJsonWithTimeout<{
    items?: MLStockItem[];
    stale?: boolean;
    error?: string;
  }>(
    `/api/ml/stock?connection_id=${encodeURIComponent(connectionId)}`,
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
