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

export interface MLOrderItem {
  item_title: string | null;
  sku: string | null;
  quantity: number;
  amount: number | null;
  item_id?: string | null;
  product_image_url?: string | null;
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

export type MLOperationalBucket = "today" | "upcoming" | "in_transit" | "finalized";

export interface MLDashboardSummaryRow {
  key: string;
  label: string;
  count: number;
}

export interface MLDashboardDeposit {
  key: string;
  label: string;
  logistic_type: string;
  counts: Record<MLOperationalBucket, number>;
  order_ids_by_bucket: Record<MLOperationalBucket, string[]>;
  operational_source: string;
  lane?: string;
  headline?: string;
  total_count?: number;
  summary_rows?: MLDashboardSummaryRow[];
  summary_rows_by_bucket?: Record<MLOperationalBucket, MLDashboardSummaryRow[]>;
}

export interface MLDashboardResponse {
  backend_secure: boolean;
  generated_at: string;
  deposits: MLDashboardDeposit[];
}

const ML_REMOTE_TIMEOUT_MS = 8000;
const ML_ORDERS_LIMIT = 1000;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string
): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), ML_REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      ...init,
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

async function postMLAuth<T>(body: Record<string, unknown>, timeoutMessage: string): Promise<T> {
  const { response, data } = await fetchJsonWithTimeout<T & { error?: string; details?: string }>(
    "/api/ml/auth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutMessage
  );

  if (!response.ok) {
    const payload = data as { error?: string; details?: string } | null;
    throw new Error(payload?.details || payload?.error || "Falha ao consultar o Mercado Livre.");
  }

  return (data ?? ({} as T)) as T;
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
  const productImageUrl = order.product_image_url || primaryItem?.product_image_url || "";

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

export async function getMLConnectionStatus(): Promise<MLConnection | null> {
  const data = await postMLAuth<{ connection?: MLConnection | null }>(
    { action: "status" },
    "Timeout ao consultar o status da conexao do Mercado Livre."
  );
  return data.connection ?? null;
}

export async function startMLOAuth(): Promise<string> {
  const { redirectUri, state, codeChallenge } = await createMLOAuthSession();
  const data = await postMLAuth<{ url?: string }>(
    {
      action: "get_auth_url",
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    },
    "Timeout ao iniciar a conexao com o Mercado Livre."
  );

  if (!data.url) {
    throw new Error("Nao foi possivel iniciar a conexao com o Mercado Livre.");
  }

  return data.url;
}

export async function exchangeMLCode(params: {
  code: string;
  redirectUri?: string;
  codeVerifier?: string;
}): Promise<MLConnection> {
  const redirectUri = params.redirectUri || resolveMLRedirectUri();
  const data = await postMLAuth<{ success?: boolean; connection?: MLConnection; error?: string; details?: string }>(
    {
      action: "exchange_code",
      code: params.code,
      redirect_uri: redirectUri,
      code_verifier: params.codeVerifier,
    },
    "Timeout ao concluir a conexao com o Mercado Livre."
  );

  if (!data.success || !data.connection) {
    throw new Error(data.details || data.error || "Nao foi possivel concluir a conexao com o Mercado Livre.");
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
): Promise<{ total_fetched: number; synced: number }> {
  const { response, data } = await fetchJsonWithTimeout<{
    success?: boolean;
    total_fetched?: number;
    synced?: number;
    details?: string;
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
    "Timeout ao sincronizar os pedidos do Mercado Livre."
  );

  if (!response.ok || !data?.success) {
    throw new Error(data?.details || data?.error || "Falha ao sincronizar os pedidos.");
  }

  return {
    total_fetched: data.total_fetched ?? 0,
    synced: data.synced ?? 0,
  };
}

export async function disconnectML(connectionId: string): Promise<void> {
  const data = await postMLAuth<{ success?: boolean; error?: string }>(
    { action: "disconnect", connection_id: connectionId },
    "Timeout ao desconectar a conta do Mercado Livre."
  );

  if (!data.success) {
    throw new Error(data.error || "Falha ao desconectar a conta.");
  }
}

export async function getMLOrders(): Promise<MLOrder[]> {
  const { response, data } = await fetchJsonWithTimeout<{ orders?: MLOrder[]; details?: string; error?: string }>(
    `/api/ml/orders?limit=${ML_ORDERS_LIMIT}`,
    {},
    "Timeout ao carregar os pedidos do Mercado Livre."
  );

  if (!response.ok) {
    throw new Error(data?.details || data?.error || "Falha ao carregar os pedidos.");
  }

  return Array.isArray(data?.orders)
    ? data.orders.map((order) => ({
        ...order,
        items: Array.isArray(order.items) ? order.items : [],
      }))
    : [];
}

export async function getMLDashboard(): Promise<MLDashboardResponse> {
  const { response, data } = await fetchJsonWithTimeout<{
    backend_secure?: boolean;
    generated_at?: string;
    deposits?: MLDashboardDeposit[];
    details?: string;
    error?: string;
  }>(
    "/api/ml/dashboard",
    {},
    "Timeout ao carregar o painel operacional do Mercado Livre."
  );

  if (!response.ok) {
    throw new Error(data?.details || data?.error || "Falha ao carregar o painel operacional.");
  }

  return {
    backend_secure: Boolean(data?.backend_secure),
    generated_at:
      typeof data?.generated_at === "string" ? data.generated_at : new Date().toISOString(),
    deposits: Array.isArray(data?.deposits) ? data.deposits : [],
  };
}
