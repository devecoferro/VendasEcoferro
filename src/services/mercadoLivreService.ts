import { supabase } from "@/integrations/supabase/client";

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
  sku: string | null;
  quantity: number;
  amount: number | null;
  order_status: string | null;
}

export async function getMLConnectionStatus(): Promise<MLConnection | null> {
  const { data } = await supabase.functions.invoke("ml-auth", {
    body: { action: "status" },
  });
  return data?.connection ?? null;
}

export async function startMLOAuth(): Promise<string> {
  const redirectUri = `${window.location.origin}/ml-callback`;
  const state = crypto.randomUUID();
  sessionStorage.setItem("ml_oauth_state", state);

  const { data, error } = await supabase.functions.invoke("ml-auth", {
    body: { action: "get_auth_url", redirect_uri: redirectUri, state },
  });

  if (error || !data?.url) throw new Error("Failed to get auth URL");
  return data.url;
}

export async function exchangeMLCode(code: string): Promise<MLConnection> {
  const redirectUri = `${window.location.origin}/ml-callback`;

  const { data, error } = await supabase.functions.invoke("ml-auth", {
    body: { action: "exchange_code", code, redirect_uri: redirectUri },
  });

  if (error || !data?.success) {
    throw new Error(data?.error || "Failed to exchange code");
  }
  return data.connection;
}

export async function syncMLOrders(
  connectionId: string,
  filters?: { date_from?: string; date_to?: string; status_filter?: string }
): Promise<{ total_fetched: number; synced: number }> {
  const { data, error } = await supabase.functions.invoke("ml-sync-orders", {
    body: { connection_id: connectionId, ...filters },
  });

  if (error || !data?.success) {
    throw new Error(data?.error || "Failed to sync orders");
  }
  return { total_fetched: data.total_fetched, synced: data.synced };
}

export async function disconnectML(connectionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("ml-disconnect", {
    body: { connection_id: connectionId },
  });

  if (error || !data?.success) {
    throw new Error("Failed to disconnect");
  }
}

export async function getMLOrders(): Promise<MLOrder[]> {
  const { data, error } = await supabase
    .from("ml_orders")
    .select("id, order_id, sale_number, sale_date, buyer_name, buyer_nickname, item_title, item_id, sku, quantity, amount, order_status")
    .order("sale_date", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data as MLOrder[]) ?? [];
}
