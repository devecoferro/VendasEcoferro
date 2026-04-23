/**
 * Classificador de sub-status conforme o Mercado Livre Seller Center.
 *
 * Cada bucket principal (today/upcoming/in_transit/finalized) tem
 * sub-secoes (Coleta, Devolucoes, Para enviar, Para retirar, etc) e
 * dentro de cada sub-secao varios sub-status especificos (Etiquetas
 * pra imprimir, NF-e, Em processamento, etc).
 *
 * Esse modulo classifica cada order da lista em uma combinacao
 * (section, substatus) replicando o que o ML mostra na UI dele.
 *
 * Usado pelo SubClassificationsBar pra renderizar os cards e filtrar
 * a lista por sub-status quando o usuario clica.
 */
import type { MLOrder } from "@/services/mercadoLivreService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import { nextBusinessDay } from "@/utils/businessDays";
import {
  isOrderInvoicePending,
  isOrderReadyToPrintLabel,
  isOrderForCollection,
  isOrderFulfillment,
} from "@/services/mercadoLivreHelpers";

// ─── Tipos ──────────────────────────────────────────────────────────────

export type MLSection =
  // Envios de hoje
  | "para_enviar_coleta"
  | "envios_devolucoes"
  // Próximos dias
  | "coleta_dia"
  | "proximos_devolucoes"
  // Em trânsito
  | "para_retirar"
  | "a_caminho"
  // Finalizadas
  | "para_atender"
  | "encerradas";

export type MLSubStatus =
  // Envios de hoje > Para enviar
  | "cancelled_no_send"      // Canceladas. Nao enviar
  | "ready_to_send"          // Prontas para enviar (today)
  | "in_distribution_center" // No centro de distribuicao (Full today)
  // Envios de hoje > Devolucoes
  | "return_pending_review"  // Revisao pendente
  | "return_arriving_today"  // Chegada hoje (devolucao chegando)
  // Proximos dias > Coleta
  | "invoice_pending"        // NF-e para gerenciar
  | "ready_to_print"         // Etiquetas para imprimir
  | "printed_ready_to_send"  // Prontas para enviar (upcoming - ja imprimiu etiqueta)
  | "in_processing"          // Em processamento
  | "standard_shipping"      // Por envio padrao
  // Proximos dias > Devolucoes
  | "return_in_transit"      // A caminho
  | "return_in_ml_review"    // Em revisao pelo Mercado Livre
  // Em trânsito > Para retirar
  | "waiting_buyer_pickup"   // Esperando retirada do comprador
  // Em trânsito > A caminho
  | "shipped_collection"     // Coleta
  | "shipped_full"           // Full (ML fulfillment em transito)
  // Finalizadas > Para atender
  | "claim_or_mediation"     // Com reclamacao ou mediacao
  // Finalizadas > Encerradas
  | "delivered"              // Entregues
  | "not_delivered"          // Nao entregues
  | "cancelled_final"        // Canceladas
  | "returns_completed"      // Devolucoes concluidas
  | "returns_not_completed"  // Devolucoes nao concluidas
  // Cross-bucket — pode aparecer em qualquer card
  | "with_unread_messages";  // Com mensagens nao lidas

// ─── Helpers internos ───────────────────────────────────────────────────

interface OrderRawData {
  status?: string;
  tags?: unknown;
  shipment_snapshot?: ShipmentSnapshot;
  pack_id?: string | number;
  date_closed?: string;
  __nfe_emitted?: boolean;
  pickup_date?: string;
  shipping?: { date_first_printed?: string; pickup_date?: string };
}

interface ShipmentSnapshot {
  status?: string;
  substatus?: string;
  logistic_type?: string;
  estimated_delivery_limit?: { date?: string } | string;
  pickup_date?: string;
  shipping_option?: {
    name?: string;
    estimated_schedule_limit?: { date?: string } | string;
    estimated_delivery_limit?: { date?: string } | string;
    estimated_delivery_final?: { date?: string } | string;
  };
  lead_time?: {
    estimated_schedule_limit?: { date?: string } | string;
    estimated_delivery_limit?: { date?: string } | string;
  };
  sla_snapshot?: { expected_date?: string };
  status_history?: {
    date_cancelled?: string;
    date_not_delivered?: string;
    date_returned?: string;
    date_handling?: string;
    date_ready_to_ship?: string;
    date_shipped?: string;
    date_delivered?: string;
  };
  date_first_printed?: string;
  return_details?: { status?: string };
}

function getRaw(order: MLOrder): OrderRawData {
  return (order.raw_data || {}) as OrderRawData;
}

function getShipment(order: MLOrder): ShipmentSnapshot {
  return getRaw(order).shipment_snapshot || {};
}

function lower(s: unknown): string {
  return String(s == null ? "" : s).toLowerCase().trim();
}

function hasTag(order: MLOrder, tag: string): boolean {
  const tags = getRaw(order).tags;
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => lower(t) === lower(tag));
}

/**
 * Detecta se o order tem mensagens não lidas do comprador.
 *
 * Why: o ML Seller Center mostra um pill "Msg. não lidas" em várias abas;
 * antes o classifier não retornava `with_unread_messages` em bucket nenhum,
 * então o filtro trazia 0 pedidos. A tag oficial da API é
 * `messages_with_unread_messages` — verificamos ela + fallbacks
 * (`messages_unread`) pra cobrir dados antigos/scraper snapshots.
 */
export function orderHasUnreadMessages(order: MLOrder): boolean {
  if (hasTag(order, "messages_with_unread_messages")) return true;
  if (hasTag(order, "unread_messages")) return true;
  const raw = getRaw(order) as OrderRawData & {
    messages_unread?: boolean;
    messenger?: { messages_unread?: boolean; new_messages_amount?: number };
  };
  if (raw.messages_unread === true) return true;
  if (raw.messenger?.messages_unread === true) return true;
  if ((raw.messenger?.new_messages_amount || 0) > 0) return true;
  return false;
}

// ─── Bucket primario (determina em qual aba o order aparece) ────────────

/**
 * Determina A QUAL BUCKET PRIMARIO o order pertence (today / upcoming /
 * in_transit / finalized / cancelled).
 *
 * E equivalente a "em qual aba do ML Seller Center este order aparece".
 * Sem isso, o classifier tentava encaixar TODO order em qualquer bucket
 * pedido e o fallback "standard_shipping" inflava artificialmente os
 * cards de "Proximos dias" com pedidos que ja foram entregues, em
 * transito ou cancelados.
 */
export function getOrderPrimaryBucket(order: MLOrder): ShipmentBucket | null {
  const raw = getRaw(order);
  const rawStatus = lower(raw.status || order.order_status);
  const ship = getShipment(order);
  const shipStatus = lower(ship.status);
  const isCancelled = rawStatus === "cancelled" || shipStatus === "cancelled";
  const wasShipped = ["shipped", "delivered", "not_delivered"].includes(shipStatus);

  // FINALIZADAS — ja entregue, devolvido (status terminal de envio)
  if (shipStatus === "delivered" || shipStatus === "returned") {
    return "finalized";
  }

  // not_delivered pode ser (a) terminal (pacote perdido, sem retorno) ou
  // (b) em transito de volta pro vendedor. O backend (dashboard.js:60-65)
  // mantem substatuses ativos de retorno em in_transit. Alinhamos aqui.
  // Sprint 2.3 — corrigir disagreement com backend.
  const shipSubstatusLower = lower(ship.substatus);
  const ACTIVE_RETURN_SUBSTATUSES = new Set([
    "returning_to_sender",
    "returning_to_hub",
    "delayed",
    "return_failed",
  ]);
  if (shipStatus === "not_delivered") {
    if (ACTIVE_RETURN_SUBSTATUSES.has(shipSubstatusLower)) {
      return "in_transit";
    }
    return "finalized";
  }

  // CANCELADOS — comportamento espelhado ao ML:
  //   - Recentes (sem date_closed OU pickup_date == hoje) e SEM ter sido
  //     expedido → Envios de hoje > Coleta > "Canceladas. Não enviar"
  //   - Antigos OU ja expedidos → Finalizadas > Encerradas > "Canceladas"
  // Ja vimos no ML que essa distincao existe — pedidos cancelados que
  // ainda NAO sairam fisicamente aparecem em "Não enviar" pra alertar
  // o operador a NAO embalar/enviar. Os com date_closed sao terminais.
  if (isCancelled) {
    if (wasShipped) return "finalized";
    const dateClosed = (raw as { date_closed?: string }).date_closed;
    if (dateClosed) {
      // Cancelado > 2 dias → Encerradas. Recente → today (alerta operador)
      const closedAt = new Date(dateClosed);
      const ageDays = (Date.now() - closedAt.getTime()) / (24 * 60 * 60 * 1000);
      if (Number.isFinite(ageDays) && ageDays > 2) return "finalized";
    }
    return "today";
  }

  // Regra de negocio EcoFerro (CLAUDE.md): pacote no ponto de retirada
  // = finalizado pro vendedor (o comprador que retira). Mesmo o ML UI
  // mostrando em 'Em transito', o workflow da EcoFerro encerra aqui.
  if (shipStatus === "shipped" && shipSubstatusLower === "waiting_for_withdrawal") {
    return "finalized";
  }

  // EM TRANSITO: ja foi expedido ou aguardando retirada
  if (
    shipStatus === "shipped" ||
    shipStatus === "in_transit" ||
    shipStatus === "ready_for_pickup"
  ) {
    return "in_transit";
  }

  // Engenharia reversa ML: pedidos com shipStatus=ready_to_ship mas
  // substatus indicando que ja sairam fisicamente (picked_up = coletado
  // pelo transportador, dropped_off = entregue no ponto ML) devem ir
  // pra "Em transito", NAO "Proximos dias". O ML Seller Center considera
  // esses "A caminho" mesmo com ship.status ainda em ready_to_ship.
  if (shipStatus === "ready_to_ship") {
    const shippedOutSubstatuses = new Set([
      "picked_up",
      "dropped_off",
      "soon_deliver",
      "out_for_delivery",
    ]);
    if (shippedOutSubstatuses.has(shipSubstatusLower)) {
      return "in_transit";
    }
  }

  // Pedidos recem-pagos com shipment ainda nao criado (pending/buffered):
  // o ML ainda ta processando a criacao do envio. No ML Seller Center,
  // esses aparecem em 'Envios de hoje' como pedidos novos exigindo
  // atencao. Engenharia reversa 2026-04-22.
  if (shipStatus === "pending" && !isCancelled) {
    return "today";
  }

  // ENVIOS DE HOJE vs PROXIMOS DIAS: distingue pela data de coleta
  const date = parsePickupDate(order);
  if (date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    if (target.getTime() <= today.getTime()) return "today";
    return "upcoming";
  }

  // Sem pickup_date conhecido — assume upcoming (fallback conservador)
  return "upcoming";
}

// ─── Sub-status (stand-alone classification) ────────────────────────────

/**
 * Retorna o sub-status PRIMARIO do order conforme o bucket informado.
 * Retorna null se o order NAO pertence ao bucket pedido — isso evita
 * que pedidos entregues/cancelados/em-transito vazem pra "Proximos dias"
 * e inflem cards artificialmente.
 */
export function getOrderSubstatus(
  order: MLOrder,
  bucket: ShipmentBucket
): MLSubStatus | null {
  // Filtro de bucket primario — order so se classifica no bucket onde
  // realmente pertence. Sem isso, todos os 1070 orders apareciam em
  // upcoming (caindo no fallback "standard_shipping").
  if (getOrderPrimaryBucket(order) !== bucket) return null;

  const rawStatus = lower(getRaw(order).status || order.order_status);
  const ship = getShipment(order);
  const shipStatus = lower(ship.status);
  const shipSubstatus = lower(ship.substatus);
  const logisticType = lower(ship.logistic_type);
  const isCancelled = rawStatus === "cancelled" || shipStatus === "cancelled";
  const hasClaim = hasTag(order, "claim") || hasTag(order, "mediation");

  // ── FINALIZADAS ──────────────────────────────────────────
  if (bucket === "finalized") {
    if (hasClaim) return "claim_or_mediation";
    if (shipStatus === "delivered") return "delivered";
    if (shipStatus === "not_delivered") return "not_delivered";
    if (isCancelled) return "cancelled_final";
    if (
      shipStatus === "returned" ||
      shipSubstatus === "delivered" ||
      shipSubstatus === "concluded"
    ) {
      return "returns_completed";
    }
    if (
      shipStatus === "in_return" ||
      shipSubstatus === "return_in_transit" ||
      shipSubstatus === "in_review"
    ) {
      return "returns_not_completed";
    }
    return "delivered"; // fallback razoavel pra Finalizadas
  }

  // ── EM TRANSITO ──────────────────────────────────────────
  if (bucket === "in_transit") {
    if (
      shipStatus === "ready_for_pickup" ||
      shipSubstatus === "ready_for_pickup" ||
      shipSubstatus === "waiting_for_pickup"
    ) {
      return "waiting_buyer_pickup";
    }
    // Full em transito: shipped com logistic_type=fulfillment
    if (logisticType === "fulfillment") return "shipped_full";
    return "shipped_collection";
  }

  // ── ENVIOS DE HOJE ───────────────────────────────────────
  if (bucket === "today") {
    if (isCancelled) return "cancelled_no_send";

    // Pedido recem-pago, shipment ainda em criacao pelo ML
    // (ship_status=pending). Aparece em 'Envios de hoje' como
    // "Aguardando etiqueta / Em preparacao". Reusa in_processing
    // semanticamente (esta sendo processado pelo sistema ML).
    if (shipStatus === "pending") {
      return "in_processing";
    }

    // Devolucao chegando hoje — observado no mockup Ourinhos today
    // ("Chegada hoje"). Status in_return com data de chegada == hoje.
    if (shipStatus === "in_return" && shipSubstatus === "return_arriving_today") {
      return "return_arriving_today";
    }

    // Devolucoes que precisam revisao do operador hoje
    if (
      shipStatus === "in_return" ||
      shipSubstatus === "return_pending_review" ||
      shipSubstatus === "pending_review"
    ) {
      return "return_pending_review";
    }

    // Full today: pedidos no centro de distribuicao do ML. Observado
    // no mockup FULL.png — "No centro de distribuicao".
    if (
      logisticType === "fulfillment" &&
      (shipStatus === "handling" ||
        shipStatus === "ready_to_ship" ||
        shipSubstatus === "in_distribution_center" ||
        shipSubstatus === "in_warehouse" ||
        shipSubstatus === "handling")
    ) {
      return "in_distribution_center";
    }

    // Ainda precisa imprimir etiqueta — vira pill "Etiqueta pronta" do ML.
    // Antes, o today sempre caia em ready_to_send; o pill "Etiqueta pronta"
    // e "Pronto pra coleta" filtravam o mesmo conjunto. Agora dividimos:
    //   ready_to_print   → nao imprimiu etiqueta ainda
    //   ready_to_send    → etiqueta ja impressa, falta dar saida na coleta
    if (shipSubstatus === "ready_to_print") {
      return "ready_to_print";
    }

    return "ready_to_send";
  }

  // ── PROXIMOS DIAS ────────────────────────────────────────
  // (Inclui Coleta + Devolucoes futuras)
  if (bucket === "upcoming") {
    // Devolucoes
    if (
      shipStatus === "in_return" ||
      shipSubstatus === "return_in_transit"
    ) {
      return "return_in_transit";
    }
    if (
      shipSubstatus === "ml_in_review" ||
      shipSubstatus === "in_ml_review" ||
      shipSubstatus === "in_review"
    ) {
      return "return_in_ml_review";
    }
    if (shipSubstatus === "return_pending_review") {
      return "return_pending_review";
    }

    // Coleta
    if (isOrderInvoicePending(order)) return "invoice_pending";
    // "Etiquetas pra imprimir" = ainda precisa imprimir (substatus ready_to_print)
    if (
      isOrderReadyToPrintLabel(order) &&
      shipSubstatus === "ready_to_print"
    ) {
      return "ready_to_print";
    }
    // "Prontas para enviar" = etiqueta ja impressa, falta apenas dar saida
    // (substatus printed). E o passo posterior a "Etiquetas pra imprimir".
    if (shipSubstatus === "printed" || shipSubstatus === "ready_to_ship") {
      return "printed_ready_to_send";
    }
    if (
      shipSubstatus === "in_packing_list" ||
      shipSubstatus === "in_hub" ||
      shipSubstatus === "in_warehouse" ||
      shipSubstatus === "packed" ||
      shipSubstatus === "handling" ||
      shipStatus === "handling"
    ) {
      return "in_processing";
    }
    // Default Coleta: por envio padrão
    if (logisticType === "cross_docking" || isOrderForCollection(order)) {
      return "standard_shipping";
    }
    return "standard_shipping";
  }

  return null;
}

// ─── Section (agrupamento de cards) ─────────────────────────────────────

/**
 * Retorna a SECTION (card) onde o order deve aparecer dentro do bucket.
 * Usada pra renderizar os cards estilo ML (lado a lado).
 */
export function getOrderSection(
  order: MLOrder,
  bucket: ShipmentBucket
): MLSection | null {
  const substatus = getOrderSubstatus(order, bucket);
  if (!substatus) return null;

  switch (bucket) {
    case "today":
      if (substatus === "return_pending_review") return "envios_devolucoes";
      return "para_enviar_coleta";

    case "upcoming":
      if (
        substatus === "return_in_transit" ||
        substatus === "return_in_ml_review" ||
        substatus === "return_pending_review"
      ) {
        return "proximos_devolucoes";
      }
      return "coleta_dia";

    case "in_transit":
      if (substatus === "waiting_buyer_pickup") return "para_retirar";
      return "a_caminho";

    case "finalized":
      if (substatus === "claim_or_mediation") return "para_atender";
      return "encerradas";

    default:
      return null;
  }
}

// ─── Pickup date label (Quarta-feira / A partir de 23 de abril) ────────

const PT_WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const PT_MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function coerceDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as { date?: string };
    if (typeof obj.date === "string") return obj.date;
  }
  return null;
}

function parsePickupDate(order: MLOrder): Date | null {
  const ship = getShipment(order);
  const raw = getRaw(order);
  // Why: antes so checavamos pickup_date e estimated_delivery_limit.
  // O sync hibrido (commit 49b2175) enriquece via shipping_option.
  // estimated_schedule_limit e lead_time.* — sem essas fontes, pedidos
  // enriquecidos caiam em "Sem data definida" e eram classificados
  // como upcoming por default.
  const candidates: Array<string | null> = [
    coerceDateString(ship.pickup_date),
    coerceDateString(ship.estimated_delivery_limit),
    coerceDateString(ship.shipping_option?.estimated_schedule_limit),
    coerceDateString(ship.shipping_option?.estimated_delivery_limit),
    coerceDateString(ship.shipping_option?.estimated_delivery_final),
    coerceDateString(ship.lead_time?.estimated_schedule_limit),
    coerceDateString(ship.lead_time?.estimated_delivery_limit),
    coerceDateString(ship.sla_snapshot?.expected_date),
    coerceDateString(raw.pickup_date),
    coerceDateString(raw.shipping?.pickup_date),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Label de agrupamento por data de coleta (pra "Próximos dias").
 *
 *   - Hoje/amanhã/depois de amanhã: nome do dia da semana ("Quarta-feira")
 *   - Mais distante: "A partir de DD de mês"
 *   - Sem data conhecida: "Sem data definida"
 */
export function getOrderPickupDateLabel(order: MLOrder): string {
  const date = parsePickupDate(order);
  if (!date) return "Sem data definida";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let target = new Date(date);
  target.setHours(0, 0, 0, 0);

  // ML nao coleta em sab/dom/feriado nacional — se a data cair num
  // desses, avanca pro proximo dia util. Evita cards "Coleta | Sabado"
  // e "Coleta | Domingo", que sao inuteis pro operador (coleta nao
  // acontece naquele dia).
  target = nextBusinessDay(target);

  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays <= 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  if (diffDays >= 2 && diffDays <= 6) {
    return PT_WEEKDAYS[target.getDay()];
  }
  // Distante: "A partir de 23 de abril"
  const day = target.getDate();
  const month = PT_MONTHS[target.getMonth()];
  return `A partir de ${day} de ${month}`;
}

// ─── Store (Loja ML) ────────────────────────────────────────────────────

export type MLStoreKey = "ourinhos" | "full" | "unknown" | string;

/**
 * Identifica em qual "loja" do ML o pedido foi feito.
 *
 * Mercado Envios Full = fulfillment (estoque do ML).
 * Outros = baseado no seller_id ou logistic_type (cross_docking, etc).
 *
 * Por enquanto suporta 2 categorias principais (full / outros).
 * Pra granularidade maior precisariamos de seller_id / store_id no
 * raw_data — adicionar em fase futura.
 */
export function getOrderStoreKey(order: MLOrder): MLStoreKey {
  const ship = getShipment(order);
  const logisticType = lower(ship.logistic_type);
  if (logisticType === "fulfillment") return "full";
  // Default: tudo que nao e Full vai pra "outros" (Ourinhos atualmente)
  return "outros";
}

export function getOrderStoreLabel(key: MLStoreKey): string {
  if (key === "full") return "Mercado Envios Full";
  if (key === "ourinhos" || key === "outros") return "Ourinhos Rua Dario Alonso";
  return "Outros";
}

// ─── Labels human-readable pros sub-status (pra UI) ─────────────────────

export const SUBSTATUS_LABELS: Record<MLSubStatus, string> = {
  cancelled_no_send: "Canceladas. Não enviar",
  ready_to_send: "Prontas para enviar",
  in_distribution_center: "No centro de distribuição",
  return_pending_review: "Revisão pendente",
  return_arriving_today: "Chegarão hoje",
  invoice_pending: "NF-e para gerenciar",
  ready_to_print: "Etiquetas para imprimir",
  printed_ready_to_send: "Prontas para enviar",
  in_processing: "Em processamento",
  standard_shipping: "Por envio padrão",
  return_in_transit: "A caminho",
  return_in_ml_review: "Em revisão pelo Mercado Livre",
  waiting_buyer_pickup: "Esperando retirada do comprador",
  shipped_collection: "Coleta",
  shipped_full: "Full",
  claim_or_mediation: "Com reclamação ou mediação",
  delivered: "Entregues",
  not_delivered: "Não entregues",
  cancelled_final: "Canceladas",
  returns_completed: "Devoluções concluídas",
  returns_not_completed: "Devoluções não concluídas",
  with_unread_messages: "Com mensagens não lidas",
};

export const SECTION_LABELS: Record<MLSection, string> = {
  para_enviar_coleta: "Para enviar — Coleta",
  envios_devolucoes: "Devoluções",
  coleta_dia: "Coleta", // sufixado dinamicamente com " | Quarta-feira" etc
  proximos_devolucoes: "Devoluções",
  para_retirar: "Para retirar",
  a_caminho: "A caminho",
  para_atender: "Para atender",
  encerradas: "Encerradas",
};

/**
 * Tom (cor) de cada sub-status pra UI. Usa tokens semanticos do app
 * (consistente com o resto do MercadoLivrePage).
 */
export type SubStatusTone = "warning" | "danger" | "info" | "success" | "neutral";

/**
 * Sub-status que tem icone de help (ⓘ) ao lado no ML Seller Center.
 * Espelha exatamente o que aparece nos screenshots de referencia.
 */
export const SUBSTATUS_HAS_HELP: Partial<Record<MLSubStatus, boolean>> = {
  invoice_pending: true,
  in_processing: true,
  standard_shipping: true,
};

/**
 * Tooltip texto pros sub-status com ⓘ (igual ML Seller Center).
 */
export const SUBSTATUS_HELP_TEXT: Partial<Record<MLSubStatus, string>> = {
  invoice_pending:
    "Pedidos com NF-e pendente. Emita pra liberar a etiqueta de envio.",
  in_processing:
    "Pedidos sendo processados internamente (em packing, hub, depósito).",
  standard_shipping:
    "Pedidos por envio padrão (cross-docking, coleta agendada).",
};

export const SUBSTATUS_TONES: Record<MLSubStatus, SubStatusTone> = {
  cancelled_no_send: "danger",
  ready_to_send: "warning",
  in_distribution_center: "info",
  return_pending_review: "warning",
  return_arriving_today: "warning",
  invoice_pending: "warning",
  ready_to_print: "warning",
  printed_ready_to_send: "warning",
  in_processing: "info",
  standard_shipping: "neutral",
  return_in_transit: "info",
  return_in_ml_review: "info",
  waiting_buyer_pickup: "warning",
  shipped_collection: "info",
  shipped_full: "info",
  claim_or_mediation: "danger",
  delivered: "success",
  not_delivered: "danger",
  cancelled_final: "danger",
  returns_completed: "success",
  returns_not_completed: "danger",
  with_unread_messages: "info",
};

// ─── Section title builder (pra MLClassificationsGrid) ─────────────────
//
// Constroi o titulo exato que o ML mostra no header de cada card, de
// acordo com (bucket × deposit × section × pickupDate). Espelha os
// mockups: "PROGRAMADA Coleta | 12h-14h" (Ourinhos today — mas sem
// horario porque pickup_window nao esta na sync ainda), "Full"
// (Full today), "Coleta | Amanhã" (Ourinhos upcoming), "Devoluções",
// "Para retirar", "A caminho", "Encerradas", etc.
//
// Retorna { subtitle?, title }:
//   - subtitle: linha pequena acima do titulo ("PROGRAMADA")
//   - title: titulo principal do card
export interface MLCardTitle {
  subtitle?: string;
  title: string;
}

export function getMLCardTitle(args: {
  bucket: ShipmentBucket;
  section: MLSection;
  deposit: MLStoreKey;
  pickupDateLabel?: string; // "Amanhã", "A partir de 24 de abril"...
}): MLCardTitle {
  const { bucket, section, deposit, pickupDateLabel } = args;

  // Finalized — titulos neutros, sem variar por deposito
  if (bucket === "finalized") {
    if (section === "para_atender") return { title: "Para atender" };
    return { title: "Encerradas" };
  }

  // In transit — "Para retirar" ou "A caminho"
  if (bucket === "in_transit") {
    if (section === "para_retirar") return { title: "Para retirar" };
    return { title: "A caminho" };
  }

  // Today — varia por deposito
  if (bucket === "today") {
    if (section === "envios_devolucoes") return { title: "Devoluções" };
    // Full today: ML renderiza tag="EM ANDAMENTO" + label="Full" (CARD_FULL)
    // Verificado via bricks.json de full/today (2026-04-23).
    if (deposit === "full") {
      return { subtitle: "EM ANDAMENTO", title: "Full" };
    }
    // Ourinhos/outros: "PROGRAMADA Coleta | 12 h - 14 h" — formato IDÊNTICO
    // ao ML Seller Center (verificado via engenharia reversa do payload
    // dashboard_operations_card: tag="PROGRAMADA", label="Coleta | 12 h - 14 h").
    // Espaços ao redor do "h" são parte do padrão ML — não remover.
    return { subtitle: "PROGRAMADA", title: "Coleta | 12 h - 14 h" };
  }

  // Upcoming — varia por section + pickup date
  if (bucket === "upcoming") {
    if (section === "proximos_devolucoes") return { title: "Devoluções" };
    // coleta_dia: "Coleta | <data>"
    return {
      title: pickupDateLabel
        ? `Coleta | ${pickupDateLabel}`
        : "Coleta",
    };
  }

  return { title: SECTION_LABELS[section] };
}
