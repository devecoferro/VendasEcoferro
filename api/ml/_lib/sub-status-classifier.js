// Espelho server-side do classifier de src/services/mlSubStatusClassifier.ts
// Mantem a mesma logica pra que o endpoint debug retorne os MESMOS
// agrupamentos que o frontend mostra. Se mudar regra aqui, mudar la tambem.

function lower(value) {
  return String(value == null ? "" : value).toLowerCase().trim();
}

function getRaw(order) {
  return order.raw_data || {};
}

function getShipment(order) {
  return getRaw(order).shipment_snapshot || {};
}

function hasTag(order, tag) {
  const tags = getRaw(order).tags;
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => lower(t) === lower(tag));
}

// Equivalentes server-side dos helpers do frontend.
// (Versao simplificada — verificar src/services/mercadoLivreHelpers.ts pros
// detalhes completos. Aqui priorizamos detectar o sub-status correto.)

function isInvoicePending(order) {
  const sub = lower(getShipment(order).substatus);
  if (sub !== "invoice_pending") return false;
  return getRaw(order).__nfe_emitted !== true;
}

function isReadyToPrintLabel(order) {
  const ship = getShipment(order);
  const status = lower(ship.status);
  const substatus = lower(ship.substatus);
  if (status !== "ready_to_ship") return false;
  if (substatus === "invoice_pending") {
    // NFe ja emitida internamente → liberado pra etiqueta
    return getRaw(order).__nfe_emitted === true;
  }
  return true;
}

function isForCollection(order) {
  const ship = getShipment(order);
  const logisticType = lower(ship.logistic_type);
  const optionName = lower((ship.shipping_option || {}).name);
  return (
    logisticType === "cross_docking" ||
    optionName.includes("coleta") ||
    optionName.includes("retirada")
  );
}

function parsePickupDate(order) {
  const ship = getShipment(order);
  const candidates = [
    ship.pickup_date,
    typeof ship.estimated_delivery_limit === "object"
      ? (ship.estimated_delivery_limit || {}).date
      : ship.estimated_delivery_limit,
    getRaw(order).pickup_date,
    (getRaw(order).shipping || {}).pickup_date,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Determina o BUCKET PRIMARIO do order. Equivale a "em qual aba do ML
 * Seller Center este order aparece". Sem isso, todos os orders cairiam
 * em qualquer bucket pedido (ja que classifier sempre tinha fallback).
 */
export function getOrderPrimaryBucket(order) {
  const raw = getRaw(order);
  const rawStatus = lower(raw.status || order.order_status);
  const ship = getShipment(order);
  const shipStatus = lower(ship.status);
  const isCancelled = rawStatus === "cancelled" || shipStatus === "cancelled";
  const wasShipped = ["shipped", "delivered", "not_delivered"].includes(shipStatus);

  if (
    shipStatus === "delivered" ||
    shipStatus === "not_delivered" ||
    shipStatus === "returned"
  ) {
    return "finalized";
  }

  // Cancelados: recentes (nao expedidos) → today | antigos → finalized
  // Espelha comportamento do ML que mostra "Canceladas. Não enviar"
  // em Envios de hoje pra alertar o operador antes do envio fisico.
  if (isCancelled) {
    if (wasShipped) return "finalized";
    const dateClosed = raw.date_closed;
    if (dateClosed) {
      const closedAt = new Date(dateClosed);
      const ageDays = (Date.now() - closedAt.getTime()) / (24 * 60 * 60 * 1000);
      if (Number.isFinite(ageDays) && ageDays > 2) return "finalized";
    }
    return "today";
  }

  if (
    shipStatus === "shipped" ||
    shipStatus === "in_transit" ||
    shipStatus === "ready_for_pickup"
  ) {
    return "in_transit";
  }

  const date = parsePickupDate(order);
  if (date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    if (target.getTime() <= today.getTime()) return "today";
    return "upcoming";
  }

  return "upcoming";
}

/**
 * Retorna o sub-status PRIMARIO do order conforme o bucket.
 * null = nao se encaixa OU order nao pertence ao bucket pedido.
 */
export function getOrderSubstatus(order, bucket) {
  // Filtro de bucket primario — order so se classifica no bucket onde
  // realmente pertence. Sem isso, todos os pedidos vazavam pra "upcoming"
  // via fallback "standard_shipping".
  if (getOrderPrimaryBucket(order) !== bucket) return null;

  const rawStatus = lower(getRaw(order).status || order.order_status);
  const ship = getShipment(order);
  const shipStatus = lower(ship.status);
  const shipSubstatus = lower(ship.substatus);
  const logisticType = lower(ship.logistic_type);
  const isCancelled = rawStatus === "cancelled" || shipStatus === "cancelled";
  const hasClaim = hasTag(order, "claim") || hasTag(order, "mediation");

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
    return "delivered";
  }

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

  if (bucket === "today") {
    if (isCancelled) return "cancelled_no_send";
    if (
      shipStatus === "in_return" ||
      shipSubstatus === "return_pending_review" ||
      shipSubstatus === "pending_review"
    ) {
      return "return_pending_review";
    }
    return "ready_to_send";
  }

  if (bucket === "upcoming") {
    if (shipStatus === "in_return" || shipSubstatus === "return_in_transit") {
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
    if (isInvoicePending(order)) return "invoice_pending";
    // "Etiquetas pra imprimir" = ainda precisa imprimir
    if (
      isReadyToPrintLabel(order) &&
      shipSubstatus === "ready_to_print"
    ) {
      return "ready_to_print";
    }
    // "Prontas para enviar" = etiqueta ja impressa, falta dar saida
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
    if (logisticType === "cross_docking" || isForCollection(order)) {
      return "standard_shipping";
    }
    return "standard_shipping";
  }

  return null;
}

export const SUBSTATUS_LABELS = {
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
