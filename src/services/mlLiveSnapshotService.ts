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

/**
 * Engenharia reversa 2026-04-28: ML retorna no event-request bricks
 * `dashboard_operations_card` (cards "Coleta", "Devoluções", "Para retirar"
 * etc) e `dashboard_operations_task` (sub-status com counts EXATOS).
 * Esses sao os MESMOS dados que ML usa pra renderizar — match 1:1.
 *
 * task_key mapeia 1:1 pra MLSubStatus do app via tabela em
 * docs/ml-bricks-reverse-engineered.md.
 */
export interface MLLiveSnapshotTask {
  task_key: string | null;
  label: string | null;
  count: number;
  /** MLSubStatus correspondente, ou null se task_key for desconhecido. */
  substatus: string | null;
}

export interface MLLiveSnapshotCard {
  /** Ex: "CARD_CROSS_DOCKING_TODAY" (sem suffix de data). */
  card_id: string;
  /** Ex: "CARD_CROSS_DOCKING_TODAY-2026-04-28T00:00@..." (com suffix). */
  card_id_full: string;
  label: string | null;
  tag: string | null;
  total: number;
  tasks: MLLiveSnapshotTask[];
}

export interface MLLiveSnapshotCardsByTab {
  today: MLLiveSnapshotCard[];
  upcoming: MLLiveSnapshotCard[];
  in_transit: MLLiveSnapshotCard[];
  finalized: MLLiveSnapshotCard[];
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
  /** Cards + tasks parseados dos bricks ML (counts exatos). Pode ser
   * undefined quando o scraper roda contra ML schema antigo ou snapshot
   * em cache de versao anterior. */
  cards_by_tab?: MLLiveSnapshotCardsByTab;
  orders: MLLiveSnapshotOrdersByTab;
  stats: MLLiveSnapshotStats;
}

export interface MLLiveSnapshotError {
  success: false;
  error: string;
  message?: string | null;
}

/**
 * Determina se um order do snapshot pertence ao depósito identificado
 * pelo `scopeKind`. Usado pra filtrar o snapshot quando o usuário
 * seleciona um escopo de loja no dropdown do topo ("Vendas sem depósito",
 * "Ourinhos", "Full").
 *
 * Mapeamento:
 *   - "without_deposit": store_label vazio/null (vendas diretas sem loja)
 *   - "full":            store_label contém "full"
 *   - "outros":          qualquer loja física (Ourinhos, Dario Alonso)
 *   - "all":             sempre true (sem filtro)
 */
export type SnapshotScope =
  | { kind: "all" }
  | { kind: "without_deposit" }
  | { kind: "full" }
  | { kind: "outros"; matchText?: string };

export function orderMatchesScope(
  order: MLLiveSnapshotOrder,
  scope: SnapshotScope
): boolean {
  if (scope.kind === "all") return true;
  const label = (order.store_label || "").toLowerCase().normalize("NFD");
  const labelStripped = label.replace(/[\u0300-\u036f]/g, "");
  if (scope.kind === "without_deposit") {
    return !order.store_label || order.store_label.trim() === "";
  }
  if (scope.kind === "full") {
    return labelStripped.includes("full") || order.channel === "fulfillment";
  }
  if (scope.kind === "outros") {
    if (!order.store_label) return false;
    if (scope.matchText) {
      return labelStripped.includes(scope.matchText.toLowerCase());
    }
    // Default "outros": qualquer loja não-Full
    return !labelStripped.includes("full");
  }
  return false;
}

/**
 * Re-agrega sub_cards a partir de uma lista de orders do snapshot.
 * Usado depois de filtrar por escopo — os sub_cards originais do
 * snapshot são globais e precisam ser recalculados pro escopo filtrado.
 */
function recomputeSubCardsFromOrders(ordersByTab: MLLiveSnapshotOrdersByTab): MLLiveSnapshotSubCards {
  const subCards: MLLiveSnapshotSubCards = {
    today: {
      label_ready_to_print: 0,
      ready_for_pickup: 0,
      ready_to_send: 0,
      with_unread_messages: 0,
      total: 0,
      by_status: {},
    },
    upcoming: {
      scheduled_pickup: 0,
      label_ready_to_print: 0,
      total: 0,
      by_pickup_date: {},
      by_status: {},
    },
    in_transit: {
      in_transit: 0,
      total: 0,
      by_status: {},
    },
    finalized: {
      delivered: 0,
      cancelled_seller: 0,
      cancelled_buyer: 0,
      with_claims: 0,
      total: 0,
      by_status: {},
    },
  };

  for (const [tabKey, orders] of Object.entries(ordersByTab) as Array<
    [keyof MLLiveSnapshotOrdersByTab, MLLiveSnapshotOrder[]]
  >) {
    const sub = subCards[tabKey];
    sub.total = orders.length;
    for (const o of orders) {
      const s = (o.status_text || "").toLowerCase();
      if (o.status_text) {
        sub.by_status[o.status_text] = (sub.by_status[o.status_text] || 0) + 1;
      }
      if (o.messages_unread) {
        (sub as MLLiveSnapshotSubCardToday).with_unread_messages =
          ((sub as MLLiveSnapshotSubCardToday).with_unread_messages || 0) + 1;
      }
      if (tabKey === "today") {
        const subT = sub as MLLiveSnapshotSubCardToday;
        if (s.includes("etiqueta pronta")) subT.label_ready_to_print++;
        else if (s.includes("pronto para coleta")) subT.ready_for_pickup++;
        if (s.includes("pronto") || s.includes("etiqueta pronta")) subT.ready_to_send++;
      } else if (tabKey === "upcoming") {
        const subU = sub as MLLiveSnapshotSubCardUpcoming;
        if (s.includes("para entregar na coleta do dia")) {
          subU.scheduled_pickup++;
          const m = o.status_text?.match(/coleta do dia (\d+ de \w+)/i);
          if (m) {
            const d = m[1];
            subU.by_pickup_date[d] = (subU.by_pickup_date[d] || 0) + 1;
          }
        } else if (s.includes("etiqueta pronta")) {
          subU.label_ready_to_print++;
        }
      } else if (tabKey === "in_transit") {
        (sub as MLLiveSnapshotSubCardInTransit).in_transit++;
      } else if (tabKey === "finalized") {
        const subF = sub as MLLiveSnapshotSubCardFinalized;
        if (s.includes("entregue")) subF.delivered++;
        else if (s.includes("não envie") || s.includes("cancelada. não")) subF.cancelled_seller++;
        else if (s.includes("cancelada pelo comprador") || s.includes("cancelado")) subF.cancelled_buyer++;
        if (o.reputation_priority && o.reputation_priority !== "NORMAL") subF.with_claims++;
      }
    }
  }
  return subCards;
}

/**
 * Retorna uma versão do snapshot filtrada pelo escopo (depósito/loja).
 * - orders: filtrados pelo match de store_label
 * - counters: recalculados contando os orders filtrados (primeira página
 *   do snapshot — até 50 por tab. Para depósitos com volumes maiores,
 *   o número pode estar SUBESTIMADO)
 * - sub_cards: re-agregados
 *
 * Quando scope.kind === "all", retorna o snapshot original sem mudanças.
 *
 * @returns snapshot escopado + flag `is_partial_count` se os counters
 *          podem estar subestimados pelo limite de 50 por tab.
 */
export function scopeLiveSnapshot(
  snapshot: MLLiveSnapshotResponse | null,
  scope: SnapshotScope
): (MLLiveSnapshotResponse & { is_partial_count?: boolean }) | null {
  if (!snapshot) return null;
  if (scope.kind === "all") return snapshot;

  const scopedOrders: MLLiveSnapshotOrdersByTab = {
    today: snapshot.orders.today.filter((o) => orderMatchesScope(o, scope)),
    upcoming: snapshot.orders.upcoming.filter((o) => orderMatchesScope(o, scope)),
    in_transit: snapshot.orders.in_transit.filter((o) => orderMatchesScope(o, scope)),
    finalized: snapshot.orders.finalized.filter((o) => orderMatchesScope(o, scope)),
  };

  // Se alguma tab tinha 50 orders (limite da primeira página), os counters
  // escopados podem estar subestimados (tab do ML tem mais que 50 no total
  // e alguns desses 50+ podem ser do escopo filtrado).
  const isPartialCount = Object.values(snapshot.orders).some(
    (arr) => arr.length >= 50
  );

  const scopedCounters: MLLiveSnapshotCounters = {
    today: scopedOrders.today.length,
    upcoming: scopedOrders.upcoming.length,
    in_transit: scopedOrders.in_transit.length,
    finalized: scopedOrders.finalized.length,
  };

  return {
    ...snapshot,
    counters: scopedCounters,
    orders: scopedOrders,
    sub_cards: recomputeSubCardsFromOrders(scopedOrders),
    is_partial_count: isPartialCount,
  };
}

/**
 * Escopo do snapshot — determina qual "filtro de depósito" do ML
 * Seller Center o scraper navega.
 */
export type MLSnapshotScope = "all" | "without_deposit" | "full" | "ourinhos";

/**
 * Busca o snapshot live do ML.
 * Por default retorna do cache (5min TTL); passe force=true pra forçar
 * scrape fresh (demora 60-90s).
 *
 * @param scope Escopo do ML: "all" (default), "without_deposit" (vendas
 *              sem depósito), "full" (Mercado Envios Full), "ourinhos"
 *              (Ourinhos Rua Dario Alonso).
 */
export async function getMLLiveSnapshot(
  options: { force?: boolean; scope?: MLSnapshotScope } = {}
): Promise<MLLiveSnapshotResponse> {
  const { force = false, scope = "all" } = options;
  const params = new URLSearchParams();
  if (force) params.set("run", "1");
  if (scope && scope !== "all") params.set("scope", scope);
  const qs = params.toString();
  const url = `/api/ml/live-snapshot${qs ? `?${qs}` : ""}`;

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
      // HTTP 202 = accepted (scrape em background, cache vazio).
      // Não é erro — indica que o cliente deve tentar de novo em 60-90s.
      if (response.status === 202) {
        throw new Error(
          `Snapshot do escopo "${scope}" ainda carregando (primeira vez demora ~90s). Tente em alguns segundos.`
        );
      }
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
