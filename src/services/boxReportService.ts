/**
 * boxReportService.ts — Acesso à API de Conferência de Saída e Relatório de Caixas.
 *
 * Fluxo:
 *  1. lookupOrder()          — busca dados do pedido pelo QR/barcode
 *  2. registrarConferencia() — salva a leitura no banco (tabela conferencia_saida)
 *  3. getBoxReport*()        — lê da tabela conferencia_saida para o relatório
 */

const BASE = "/api/ml/box-report";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface BoxLookupResult {
  found: boolean;
  q: string;
  is_pack: boolean;
  pack_id: string | null;
  connection_id: string;
  company: string;
  ship_status: string | null;
  shipping_id: string | null;
  total_amount: number;
  total_qty: number;
  orders: Array<{
    sale_number: string;
    order_id: string;
    buyer_name: string;
    item_title: string;
    sku: string;
    amount: number;
    quantity: number;
    sale_date: string;
  }>;
}

export interface RegistrarConferenciaPayload {
  session_id: string;
  shipping_id: string;
  order_id?: string;
  sale_number?: string;
  pack_id?: string;
  connection_id: string;
  seller_nickname: string;
  item_title?: string;
  buyer_name?: string;
  amount: number;
  order_count: number;
}

export interface RegistrarConferenciaResult {
  ok: boolean;
  duplicate: boolean;
  session_id: string;
  shipping_id: string;
  session_date: string;
}

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
  session_date: string;
  shipped_at: string | null;
  order_count: number;
  total_amount: number;
  pack_id: string | null;
  sale_number: string | null;
  order_id: string | null;
  item_title: string | null;
  buyer_name: string | null;
  operator_name: string | null;
  session_id: string;
}

export interface BoxListReport {
  date_from: string;
  date_to: string;
  total: number;
  items: BoxListItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Lookup ───────────────────────────────────────────────────────────────────

export async function lookupOrder(q: string): Promise<BoxLookupResult> {
  return fetchJson<BoxLookupResult>(`${BASE}/lookup?q=${encodeURIComponent(q)}`);
}

// ─── Registrar conferência ────────────────────────────────────────────────────

export async function registrarConferencia(
  payload: RegistrarConferenciaPayload
): Promise<RegistrarConferenciaResult> {
  const res = await fetch(`${BASE}/conferencia`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<RegistrarConferenciaResult>;
}

// ─── Relatório (lê da conferencia_saida) ─────────────────────────────────────

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
  limit?: string;
}): Promise<BoxListReport> {
  return fetchJson<BoxListReport>(`${BASE}/list${buildParams(params)}`);
}
