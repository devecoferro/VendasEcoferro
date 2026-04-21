// ─── Live Snapshot ML (Fase 2 — dados 1:1 com o ML Seller Center) ────
//
// Consome o endpoint /api/ml/live-snapshot que o backend preenche via
// scraper Playwright autenticado. Retorna:
//   - counters: 4 chips principais (today/upcoming/in_transit/finalized)
//     que batem 1:1 com o banner do ML
//   - sub_cards: agregação local dos status humanos
//     ("Etiqueta pronta para impressão", "Pronto para coleta", etc)
//   - orders: até ~50 primeiros pedidos de cada tab com dados
//     normalizados (pack_id, order_id, status_text, buyer_name,
//     store_label, shipment_ids, url_detail, date_text, etc)

const LIVE_SNAPSHOT_TIMEOUT_MS = 200_000; // 200s (scrape demora ~60-90s)

export interface MLLiveSnapshotCounters {
  today: number;
  upcoming: number;
  in_transit: number;
  finalized: number;
}

export interface MLLiveSnapshotSubCardToday {
  label_ready_to_print: number;
  ready_for_pickup: number;
  ready_to_send: number;
  with_unread_messages: number;
  total: number;
  by_status: Record<string, number>;
}

export interface MLLiveSnapshotSubCardUpcoming {
  scheduled_pickup: number;
  label_ready_to_print: number;
  total: number;
  by_pickup_date: Record<string, number>;
  by_status: Record<string, number>;
}

export interface MLLiveSnapshotSubCardInTransit {
  in_transit: number;
  total: number;
  by_status: Record<string, number>;
}

export interface MLLiveSnapshotSubCardFinalized {
  delivered: number;
  cancelled_seller: number;
  cancelled_buyer: number;
  with_claims: number;
  total: number;
  by_status: Record<string, number>;
}

export interface MLLiveSnapshotSubCards {
  today: MLLiveSnapshotSubCardToday;
  upcoming: MLLiveSnapshotSubCardUpcoming;
  in_transit: MLLiveSnapshotSubCardInTransit;
  finalized: MLLiveSnapshotSubCardFinalized;
}

export interface MLLiveSnapshotOrder {
  pack_id: string;
  order_id: string;
  row_id: string;
  status_text: string | null;
  description: string | null;
  priority: "high" | "normal" | "low" | string;
  buyer_name: string | null;
  buyer_nickname: string | null;
  store_label: string | null;
  date_text: string | null;
  channel: string | null;
  reputation_text: string | null;
  reputation_priority: string | null;
  shipment_ids: number[];
  primary_action_text: string | null;
  messages_unread: boolean;
  new_messages_amount: number;
  url_detail: string | null;
}

export interface MLLiveSnapshotOrdersByTab {
  today: MLLiveSnapshotOrder[];
  upcoming: MLLiveSnapshotOrder[];
  in_transit: MLLiveSnapshotOrder[];
  finalized: MLLiveSnapshotOrder[];
}

export interface MLLiveSnapshotStats {
  total_orders: number;
  tabs_with_data: Array<keyof MLLiveSnapshotOrdersByTab>;
  xhr_count: number;
  navs_successful?: number;
}

export interface MLLiveSnapshotResponse {
  success: true;
  from_cache: boolean;
  stale: boolean;
  /** True quando o backend está rodando scrape fresh em background. */
  scrape_in_progress?: boolean;
  /** Info sobre o background refresh (se foi disparado neste request). */
  background_refresh?: { triggered: boolean; reason?: string } | null;
  captured_at: string;
  counters: MLLiveSnapshotCounters;
  sub_cards: MLLiveSnapshotSubCards;
  orders: MLLiveSnapshotOrdersByTab;
  stats: MLLiveSnapshotStats;
}

export interface MLLiveSnapshotError {
  success: false;
  error: string;
  message?: string | null;
}

/**
 * Busca o snapshot live do ML.
 * Por default retorna do cache (5min TTL); passe force=true pra forçar
 * scrape fresh (demora 60-90s).
 */
export async function getMLLiveSnapshot(
  options: { force?: boolean } = {}
): Promise<MLLiveSnapshotResponse> {
  const { force = false } = options;
  const url = force
    ? "/api/ml/live-snapshot?run=1"
    : "/api/ml/live-snapshot";

  const controller = new AbortController();
  // Force scrape pode demorar 180s no servidor; cache hit é instantâneo.
  const timeoutMs = force ? LIVE_SNAPSHOT_TIMEOUT_MS : 30_000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: "include",
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as
      | MLLiveSnapshotResponse
      | MLLiveSnapshotError
      | null;

    if (!response.ok || !data || data.success === false) {
      const message =
        (data as MLLiveSnapshotError | null)?.message ||
        (data as MLLiveSnapshotError | null)?.error ||
        `Falha ao carregar snapshot ML (HTTP ${response.status}).`;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        force
          ? "Timeout ao rodar scrape fresh do ML (>180s). Tente novamente."
          : "Timeout ao ler cache do snapshot ML."
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
