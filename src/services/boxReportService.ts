/**
 * boxReportService.ts — Acesso à API de relatório de caixas despachadas.
 * Leitura pura dos pedidos ML já sincronizados no banco.
 */

const BASE = "/api/ml/box-report";

export interface BoxReportSummaryCompany {
  connection_id: string;
  seller_nickname: string;
  total_boxes: number;
  total_orders: number;
  total_amount: number;
}

export interface BoxReportSummary {
  date_from: string;
  date_to: string;
  totals: {
    total_boxes: number;
    total_orders: number;
    total_amount: number;
  };
  by_company: BoxReportSummaryCompany[];
}

export interface DailySeriesEntry {
  date: string;
  total_boxes: number;
  total_orders: number;
  total_amount: number;
  by_company: Record<string, { boxes: number; orders: number; amount: number }>;
}

export interface DailyReport {
  date_from: string;
  date_to: string;
  series: DailySeriesEntry[];
}

export interface BoxListItem {
  shipping_id: string;
  seller_nickname: string;
  connection_id: string;
  shipped_at: string | null;
  order_count: number;
  total_amount: number;
  pack_id: number | null;
  substatus: string | null;
  logistic_type: string | null;
}

export interface BoxListReport {
  date_from: string;
  date_to: string;
  total: number;
  page: number;
  limit: number;
  items: BoxListItem[];
}

export interface TodayBoxCompany {
  connection_id: string;
  seller_nickname: string;
  total_boxes: number;
  total_orders: number;
  total_amount: number;
  boxes: Array<{
    shipping_id: string;
    shipped_at: string | null;
    order_count: number;
    total_amount: number;
    pack_id: number | null;
    substatus: string | null;
    logistic_type: string | null;
  }>;
}

export interface TodayReport {
  date: string;
  total_boxes: number;
  total_orders: number;
  total_amount: number;
  by_company: TodayBoxCompany[];
}

function buildParams(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, v);
  }
  return p.toString() ? `?${p.toString()}` : "";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function getBoxReportSummary(params: {
  date_from?: string;
  date_to?: string;
  connection_id?: string;
}): Promise<BoxReportSummary> {
  return fetchJson<BoxReportSummary>(`${BASE}/summary${buildParams(params)}`);
}

export async function getBoxReportDaily(params: {
  date_from?: string;
  date_to?: string;
  connection_id?: string;
}): Promise<DailyReport> {
  return fetchJson<DailyReport>(`${BASE}/daily${buildParams(params)}`);
}

export async function getBoxReportList(params: {
  date_from?: string;
  date_to?: string;
  connection_id?: string;
  page?: string;
  limit?: string;
}): Promise<BoxListReport> {
  return fetchJson<BoxListReport>(`${BASE}/list${buildParams(params)}`);
}

export async function getBoxReportToday(): Promise<TodayReport> {
  return fetchJson<TodayReport>(`${BASE}/today`);
}

export interface BoxLookupResult {
  found: boolean;
  q: string;
  is_pack: boolean;
  pack_id: number | null;
  connection_id: string;
  company: string;
  ship_status: string | null;
  shipping_id: string | null;
  total_amount: number;
  total_qty: number;
  orders: Array<{
    sale_number: string;
    buyer_name: string;
    item_title: string;
    sku: string;
    amount: number;
    quantity: number;
    sale_date: string;
  }>;
}

export async function lookupOrder(q: string): Promise<BoxLookupResult> {
  return fetchJson<BoxLookupResult>(`${BASE}/lookup?q=${encodeURIComponent(q)}`);
}
