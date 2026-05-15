/**
 * Service de Caixas de Saída (Shipping Boxes)
 * Comunica com /api/ml/boxes
 */

export type BoxStatus = "open" | "confirmed" | "dispatched";

export interface ShippingBox {
  id: string;
  box_number: string;
  connection_id: string;
  seller_nickname: string;
  order_ids: string[];
  order_count: number;
  total_amount: number;
  status: BoxStatus;
  tracking_code: string | null;
  carrier: string | null;
  dispatch_date: string | null;
  notes: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
  // Enriquecido no GET /:id
  orders?: BoxOrder[];
}

export interface BoxOrder {
  order_id: string;
  sale_number: string;
  buyer_name: string | null;
  buyer_nickname: string | null;
  item_title: string | null;
  sku: string | null;
  amount: number;
  order_status: string;
}

export interface BoxesListResponse {
  boxes: ShippingBox[];
  total: number;
  limit: number;
  offset: number;
}

export interface BoxReportCompany {
  seller_nickname: string;
  connection_id: string;
  total_boxes: number;
  total_orders: number;
  total_amount: number;
  by_status: { open: number; confirmed: number; dispatched: number };
  boxes: ShippingBox[];
}

export interface BoxReportResponse {
  totals: {
    total_boxes: number;
    total_orders: number;
    total_amount: number;
    by_status: { open: number; confirmed: number; dispatched: number };
  };
  by_company: BoxReportCompany[];
  boxes: ShippingBox[];
  filters: {
    date_from: string | null;
    date_to: string | null;
    connection_id: string | null;
  };
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listBoxes(params?: {
  status?: BoxStatus;
  connection_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}): Promise<BoxesListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.connection_id) qs.set("connection_id", params.connection_id);
  if (params?.date_from) qs.set("date_from", params.date_from);
  if (params?.date_to) qs.set("date_to", params.date_to);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  return apiFetch<BoxesListResponse>(`/api/ml/boxes?${qs}`);
}

export async function getBox(id: string): Promise<{ box: ShippingBox }> {
  return apiFetch<{ box: ShippingBox }>(`/api/ml/boxes/${id}`);
}

export async function createBox(data: {
  connection_id: string;
  order_ids?: string[];
  notes?: string;
  tracking_code?: string;
  carrier?: string;
}): Promise<{ box: ShippingBox }> {
  return apiFetch<{ box: ShippingBox }>("/api/ml/boxes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBox(
  id: string,
  data: {
    order_ids?: string[];
    notes?: string;
    tracking_code?: string;
    carrier?: string;
  }
): Promise<{ box: ShippingBox }> {
  return apiFetch<{ box: ShippingBox }>(`/api/ml/boxes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteBox(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/ml/boxes/${id}`, { method: "DELETE" });
}

export async function confirmBox(id: string): Promise<{ box: ShippingBox }> {
  return apiFetch<{ box: ShippingBox }>(`/api/ml/boxes/${id}/confirm`, { method: "POST" });
}

export async function dispatchBox(
  id: string,
  data?: { tracking_code?: string; carrier?: string; dispatch_date?: string }
): Promise<{ box: ShippingBox }> {
  return apiFetch<{ box: ShippingBox }>(`/api/ml/boxes/${id}/dispatch`, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export async function getBoxReport(params?: {
  date_from?: string;
  date_to?: string;
  connection_id?: string;
}): Promise<BoxReportResponse> {
  const qs = new URLSearchParams();
  if (params?.date_from) qs.set("date_from", params.date_from);
  if (params?.date_to) qs.set("date_to", params.date_to);
  if (params?.connection_id) qs.set("connection_id", params.connection_id);
  return apiFetch<BoxReportResponse>(`/api/ml/boxes/report?${qs}`);
}
