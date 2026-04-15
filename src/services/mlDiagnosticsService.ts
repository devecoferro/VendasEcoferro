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

export interface FetchChipDiffParams {
  tolerance?: number;
  includeBreakdown?: boolean;
  filters?: ChipDiffFilters;
  save?: boolean;
  fresh?: boolean;
}

function buildDiagnosticsUrl(
  action: "verify" | "history",
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const query = new URLSearchParams();
  if (action === "history") query.set("action", "history");
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
