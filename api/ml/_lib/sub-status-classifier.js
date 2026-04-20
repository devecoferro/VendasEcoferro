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

/**
 * Retorna o sub-status PRIMARIO do order conforme o bucket.
 * null = nao se encaixa.
 */
export function getOrderSubstatus(order, bucket) {
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
    if (isReadyToPrintLabel(order)) return "ready_to_print";
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
};
