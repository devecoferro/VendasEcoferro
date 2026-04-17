// Frontend service for /api/ml/diagnostics — chip count drift verification.
// Compares ML Seller Center live counts against the app's internal classification.

export type ChipDiffStatus = "IN_SYNC" | "DRIFT_DETECTED" | "ML_API_UNAVAILABLE";

export interface ChipBucketCounts {
  today: number;
  upcoming: number;
  in_transit: number;
  finalized: number;
  cancelled: number;
}

export interface ChipDepositBreakdownItem {
  key: string;
  label: string;
  logistic_type: string;
  counts: ChipBucketCounts;
  total: number;
}

export interface ChipDiffFilters {
  deposit_key?: string;
  logistic_type?: string;
}

export interface ChipCountDiff {
  timestamp: string;
  status: ChipDiffStatus;
  tolerance: number;
  max_abs_diff: number;
  ml_seller_center: ChipBucketCounts;
  app_internal: ChipBucketCounts;
  diff: ChipBucketCounts;
  filters: ChipDiffFilters;
  filter_applied: boolean;
  filter_warning?: string | null;
  breakdown_by_deposit?: ChipDepositBreakdownItem[];
  error?: string;
}

export interface ChipDriftHistoryEntry {
  id: number;
  captured_at: string;
  status: ChipDiffStatus;
  max_abs_diff: number;
  ml_today: number;
  ml_upcoming: number;
  ml_in_transit: number;
  ml_finalized: number;
  ml_cancelled: number;
  app_today: number;
  app_upcoming: number;
  app_in_transit: number;
  app_finalized: number;
  app_cancelled: number;
  diff_today: number;
  diff_upcoming: number;
  diff_in_transit: number;
  diff_finalized: number;
  diff_cancelled: number;
  filters_json: string | null;
  source: string | null;
}

export interface ChipDriftHistoryResponse {
  history: ChipDriftHistoryEntry[];
  count: number;
}

export type ChipBucketName = keyof ChipBucketCounts;

export interface OrderDivergence {
  order_id: string;
  ml_bucket: ChipBucketName | null;
  app_bucket: ChipBucketName | null;
}

export interface OrdersDivergencePattern {
  pattern: string; // "app_bucket→ml_bucket" ex: "upcoming→today"
  count: number;
}

export interface OrdersDivergenceResponse {
  timestamp: string;
  error?: string;
  ml_connections_queried: number;
  ml_connections_succeeded: number;
  total_divergent: number;
  patterns: OrdersDivergencePattern[];
  divergences: OrderDivergence[];
  truncated: boolean;
}

export type AutoHealReason =
  | "ALREADY_IN_SYNC"
  | "RESOLVED_AFTER_REFRESH"
  | "PARTIALLY_HEALED"
  | "PERSISTENT_CLASSIFICATION_BUG"
  | "ML_API_UNAVAILABLE";

export interface AutoHealResponse {
  healed: boolean;
  reason: AutoHealReason;
  refreshed_orders: number;
  before: ChipCountDiff;
  after: ChipCountDiff | null;
}

export type HardHealReason =
  | "ALREADY_IN_SYNC"
  | "RESOLVED_AFTER_HARD_REFRESH"
  | "PARTIALLY_HEALED"
  | "PERSISTENT_CLASSIFICATION_LOGIC_BUG"
  | "NO_ORDER_LEVEL_DIVERGENCE"
  | "ML_API_UNAVAILABLE"
  | "ML_API_UNAVAILABLE_AFTER_REFRESH";

export interface HardHealResponse {
  healed: boolean;
  reason: HardHealReason;
  orders_refreshed: number;
  divergences_before: number;
  patterns: OrdersDivergencePattern[];
  before: ChipCountDiff;
  after: ChipCountDiff | null;
  errors: Array<{ order_id: string | null; message: string }>;
  timestamp: string;
}

export interface FetchChipDiffParams {
  tolerance?: number;
  includeBreakdown?: boolean;
  filters?: ChipDiffFilters;
  save?: boolean;
  fresh?: boolean;
}

function buildDiagnosticsUrl(
  action: "verify" | "history" | "orders-diff" | "heal" | "hard-heal",
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const query = new URLSearchParams();
  if (action !== "verify") query.set("action", action);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "" || value === false) continue;
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return `/api/ml/diagnostics${qs ? `?${qs}` : ""}`;
}

export async function fetchChipDiff(
  params: FetchChipDiffParams = {}
): Promise<ChipCountDiff> {
  const url = buildDiagnosticsUrl("verify", {
    tolerance: params.tolerance,
    breakdown: params.includeBreakdown === false ? "false" : undefined,
    fresh: params.fresh ? "true" : undefined,
    save: params.save ? "true" : undefined,
    deposit_key: params.filters?.deposit_key,
    logistic_type: params.filters?.logistic_type,
  });

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `Failed to fetch chip diff (HTTP ${response.status})`
    );
  }
  return (await response.json()) as ChipCountDiff;
}

export async function fetchChipDriftHistory(
  limit = 50
): Promise<ChipDriftHistoryResponse> {
  const url = buildDiagnosticsUrl("history", { limit });
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `Failed to fetch drift history (HTTP ${response.status})`
    );
  }
  return (await response.json()) as ChipDriftHistoryResponse;
}

/**
 * Analise order-level: retorna EXATAMENTE quais pedidos estao em buckets
 * diferentes entre ML e app. Operacao cara (~10-20s) — usar sob demanda.
 */
export async function fetchOrdersDivergence(
  params: { fresh?: boolean; limit?: number } = {}
): Promise<OrdersDivergenceResponse> {
  const url = buildDiagnosticsUrl("orders-diff", {
    fresh: params.fresh === false ? undefined : "true",
    limit: params.limit,
  });
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `Failed to fetch orders divergence (HTTP ${response.status})`
    );
  }
  return (await response.json()) as OrdersDivergenceResponse;
}

/**
 * Dispara auto-heal: forca refresh dos pedidos ativos em todas as conexoes
 * e re-verifica. Se o drift era timing, auto-corrige; se persistir, e bug
 * de classificacao.
 */
export async function triggerAutoHeal(
  params: { tolerance?: number } = {}
): Promise<AutoHealResponse> {
  const url = buildDiagnosticsUrl("heal", { tolerance: params.tolerance });
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `Auto-heal failed (HTTP ${response.status})`
    );
  }
  return (await response.json()) as AutoHealResponse;
}

/**
 * Hard heal: identifica pedidos divergentes via computeOrdersDivergence e
 * re-busca cada um via ML API direto, sobrescrevendo raw_data no DB com a
 * fonte de verdade do Mercado Livre. Lento (~N*2 ML API calls) mas é a
 * correção profunda quando o soft heal não resolve.
 */
export async function triggerHardHeal(
  params: { tolerance?: number; max?: number } = {}
): Promise<HardHealResponse> {
  const url = buildDiagnosticsUrl("hard-heal", {
    tolerance: params.tolerance,
    max: params.max,
  });
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error || `Hard-heal failed (HTTP ${response.status})`
    );
  }
  return (await response.json()) as HardHealResponse;
}

export const CHIP_BUCKET_LABELS: Record<keyof ChipBucketCounts, string> = {
  today: "Envios de hoje",
  upcoming: "Próximos dias",
  in_transit: "Em trânsito",
  finalized: "Finalizadas",
  cancelled: "Canceladas",
};

export const CHIP_BUCKET_ORDER: Array<keyof ChipBucketCounts> = [
  "today",
  "upcoming",
  "in_transit",
  "finalized",
  "cancelled",
];
