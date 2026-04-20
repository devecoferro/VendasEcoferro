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
  // Envios de hoje > Devolucoes
  | "return_pending_review"  // Revisao pendente
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
  shipping_option?: { name?: string };
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

// ─── Sub-status (stand-alone classification) ────────────────────────────

/**
 * Retorna o sub-status PRIMARIO do order conforme o bucket informado.
 * null = order nao se encaixa em nenhum sub-status conhecido (raro).
 *
 * Mesma logica que o ML Seller Center usa pra classificar nos cards.
 */
export function getOrderSubstatus(
  order: MLOrder,
  bucket: ShipmentBucket
): MLSubStatus | null {
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
    return "shipped_collection";
  }

  // ── ENVIOS DE HOJE ───────────────────────────────────────
  if (bucket === "today") {
    if (isCancelled) return "cancelled_no_send";
    // Devolucoes que precisam revisao do operador hoje
    if (
      shipStatus === "in_return" ||
      shipSubstatus === "return_pending_review" ||
      shipSubstatus === "pending_review"
    ) {
      return "return_pending_review";
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

function parsePickupDate(order: MLOrder): Date | null {
  const ship = getShipment(order);
  // Tenta varios campos comuns onde o ML guarda a data de coleta
  const candidates = [
    ship.pickup_date,
    typeof ship.estimated_delivery_limit === "object"
      ? ship.estimated_delivery_limit?.date
      : ship.estimated_delivery_limit,
    getRaw(order).pickup_date,
    getRaw(order).shipping?.pickup_date,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;
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
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

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
  return_pending_review: "Revisão pendente",
  invoice_pending: "NF-e para gerenciar",
  ready_to_print: "Etiquetas para imprimir",
  printed_ready_to_send: "Prontas para enviar",
  in_processing: "Em processamento",
  standard_shipping: "Por envio padrão",
  return_in_transit: "A caminho",
  return_in_ml_review: "Em revisão pelo Mercado Livre",
  waiting_buyer_pickup: "Esperando retirada do comprador",
  shipped_collection: "Coleta",
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

export const SUBSTATUS_TONES: Record<MLSubStatus, SubStatusTone> = {
  cancelled_no_send: "danger",
  ready_to_send: "warning",
  return_pending_review: "warning",
  invoice_pending: "warning",
  ready_to_print: "warning",
  printed_ready_to_send: "warning",
  in_processing: "info",
  standard_shipping: "neutral",
  return_in_transit: "info",
  return_in_ml_review: "info",
  waiting_buyer_pickup: "warning",
  shipped_collection: "info",
  claim_or_mediation: "danger",
  delivered: "success",
  not_delivered: "danger",
  cancelled_final: "danger",
  returns_completed: "success",
  returns_not_completed: "danger",
  with_unread_messages: "info",
};
