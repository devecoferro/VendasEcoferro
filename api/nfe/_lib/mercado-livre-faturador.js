import { ensureValidAccessToken } from "../../ml/_lib/mercado-livre.js";
import {
  getLatestConnection,
  getOrders,
  getOrderRowsByOrderId,
  getOrderRowsByPackId,
} from "../../ml/_lib/storage.js";
import { consolidateOrders } from "../../ml/orders.js";
import {
  getNfeDocumentByOrderId,
  hasNfeDanfeFile,
  hasNfeXmlFile,
  listNfeDocumentsBySellerId,
  readNfeDanfeFile,
  readNfeXmlFile,
  saveNfeDanfeFile,
  saveNfeXmlFile,
  upsertNfeDocument,
} from "./nfe-storage.js";

const NFE_SOURCE = "mercado_livre_faturador";
const DEFAULT_SITE_ID = "MLB";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeState(value, fallback = "") {
  return normalizeNullable(value)?.toLowerCase() || fallback;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
  }
  return false;
}

function buildNotFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function getRawData(order) {
  return order?.raw_data && typeof order.raw_data === "object" ? order.raw_data : {};
}

function getShipmentSnapshot(order) {
  const rawData = getRawData(order);
  return rawData.shipment_snapshot && typeof rawData.shipment_snapshot === "object"
    ? rawData.shipment_snapshot
    : {};
}

function getDepositSnapshot(order) {
  const rawData = getRawData(order);
  return rawData.deposit_snapshot && typeof rawData.deposit_snapshot === "object"
    ? rawData.deposit_snapshot
    : {};
}

function getBillingInfoSnapshot(order) {
  const rawData = getRawData(order);
  return rawData.billing_info_snapshot && typeof rawData.billing_info_snapshot === "object"
    ? rawData.billing_info_snapshot
    : {};
}

function resolveSiteId(order) {
  return (
    normalizeNullable(getShipmentSnapshot(order).site_id) ||
    normalizeNullable(getRawData(order).site_id) ||
    DEFAULT_SITE_ID
  );
}

function resolvePackOrderIds(order, allPackOrders) {
  const packId = normalizeNullable(getRawData(order).pack_id);
  if (!packId) {
    return [String(order.order_id)];
  }

  const orderIds = [
    ...new Set(
      allPackOrders
        .map((entry) => String(entry.order_id || "").trim())
        .filter(Boolean)
    ),
  ];

  return orderIds.length > 0 ? orderIds : [String(order.order_id)];
}

function getOrderItems(order) {
  if (Array.isArray(order?.items) && order.items.length > 0) {
    return order.items;
  }

  const rawItems = Array.isArray(getRawData(order).order_items) ? getRawData(order).order_items : [];
  return rawItems;
}

function getOrderItemReferences(order) {
  return getOrderItems(order)
    .map((item) => ({
      item_id: normalizeNullable(item?.item_id || item?.item?.id || item?.id),
      sku: normalizeNullable(item?.sku || item?.seller_sku || item?.item?.seller_sku),
      variation_id: normalizeNullable(item?.variation_id || item?.item?.variation_id),
    }))
    .filter((item) => item.item_id || item.sku);
}

function buildContext(orderId) {
  const normalizedOrderId = normalizeNullable(orderId);
  if (!normalizedOrderId) {
    throw buildNotFoundError("order_id é obrigatório para NF-e.");
  }

  const connection = getLatestConnection();
  if (!connection?.id || !connection.seller_id) {
    const error = new Error("Conexão do Mercado Livre não encontrada.");
    error.statusCode = 400;
    throw error;
  }

  const rows = getOrderRowsByOrderId(normalizedOrderId);
  const order = consolidateOrders(rows)[0] || null;
  if (!order) {
    throw buildNotFoundError("Pedido não encontrado na base local.");
  }

  const rawData = getRawData(order);
  const shipmentSnapshot = getShipmentSnapshot(order);
  const depositSnapshot = getDepositSnapshot(order);
  const packId = normalizeNullable(rawData.pack_id);
  const packRows = packId ? getOrderRowsByPackId(packId) : [];
  const packOrders = packId ? consolidateOrders(packRows) : [];

  return {
    connection,
    order,
    seller_id: String(connection.seller_id),
    order_id: normalizedOrderId,
    shipment_id: normalizeNullable(order.shipping_id || shipmentSnapshot.id),
    pack_id: packId,
    site_id: resolveSiteId(order),
    logistic_type: normalizeState(shipmentSnapshot.logistic_type),
    shipment_status: normalizeState(shipmentSnapshot.status),
    shipment_substatus: normalizeState(shipmentSnapshot.substatus),
    deposit_label:
      normalizeNullable(depositSnapshot.label) ||
      normalizeNullable(depositSnapshot.display_label) ||
      null,
    billing_info_status: normalizeState(getRawData(order).billing_info_status),
    billing_info_snapshot: getBillingInfoSnapshot(order),
    pack_orders: packOrders,
    pack_order_ids: resolvePackOrderIds(order, packOrders),
  };
}

function buildReadinessCheck({
  key,
  label,
  passed,
  blocking = true,
  value = null,
  detail = null,
}) {
  return {
    key,
    label,
    passed: Boolean(passed),
    blocking: Boolean(blocking),
    value: value == null ? null : String(value),
    detail: detail == null ? null : String(detail),
  };
}

function getBuyerBillingInfo(context) {
  const billingInfo =
    context.billing_info_snapshot?.buyer?.billing_info &&
    typeof context.billing_info_snapshot.buyer.billing_info === "object"
      ? context.billing_info_snapshot.buyer.billing_info
      : {};

  const identification =
    billingInfo.identification && typeof billingInfo.identification === "object"
      ? billingInfo.identification
      : {};
  const address =
    billingInfo.address && typeof billingInfo.address === "object" ? billingInfo.address : {};

  return {
    billingInfo,
    identification,
    address,
  };
}

function summarizeBlockingChecks(checks) {
  return checks
    .filter((check) => check.blocking && !check.passed)
    .map((check) => check.label);
}

function buildReadinessPayload({ allowed, status, note, checks }) {
  return {
    allowed,
    status,
    note,
    checks,
    blocking_reasons: summarizeBlockingChecks(checks),
  };
}

async function fetchMercadoLivreJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  return { response, payload };
}

async function fetchBinary(url, accessToken, accept = "*/*") {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: accept,
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const error = new Error(details || `Falha ao baixar documento fiscal (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }

  return {
    contentType: response.headers.get("content-type") || "application/octet-stream",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

function buildAbsoluteApiUrl(pathOrUrl) {
  const normalized = normalizeNullable(pathOrUrl);
  if (!normalized) return null;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    if (normalized.includes("internal.mercadolibre.com")) {
      return normalized
        .replace("http://internal.mercadolibre.com", "https://api.mercadolibre.com")
        .replace("https://internal.mercadolibre.com", "https://api.mercadolibre.com");
    }
    return normalized;
  }
  if (normalized.startsWith("/")) {
    return `https://api.mercadolibre.com${normalized}`;
  }
  return `https://api.mercadolibre.com/${normalized}`;
}

function normalizeMeliInvoicePayload(payload) {
  const attributes = payload?.attributes && typeof payload.attributes === "object"
    ? payload.attributes
    : {};

  const rawStatus = normalizeState(
    payload?.status || attributes.status || payload?.state || attributes.status_description
  );
  const transactionStatus = normalizeState(
    payload?.transaction_status || attributes.transaction_status
  );
  const authorizedAt =
    normalizeNullable(attributes.authorization_date) ||
    normalizeNullable(attributes.receipt_date) ||
    null;
  const invoiceId = normalizeNullable(payload?.id);
  const xmlUrl = buildAbsoluteApiUrl(attributes.xml_location || attributes.document || payload?.xml_location);
  const danfeUrl = buildAbsoluteApiUrl(attributes.danfe_location || attributes.danfe || payload?.danfe_location);

  return {
    invoice_id: invoiceId,
    invoice_number: normalizeNullable(payload?.invoice_number),
    invoice_series: normalizeNullable(payload?.invoice_series),
    invoice_key: normalizeNullable(attributes.invoice_key),
    authorization_protocol: normalizeNullable(attributes.protocol),
    status: rawStatus,
    transaction_status: transactionStatus,
    environment: normalizeNullable(attributes.environment_type),
    issued_at:
      normalizeNullable(payload?.issued_date) ||
      normalizeNullable(attributes.invoice_creation_date) ||
      null,
    authorized_at: authorizedAt,
    issuer_user_id:
      normalizeNullable(payload?.issuer?.user_id) ||
      normalizeNullable(payload?.issuer?.issuer_identification) ||
      null,
    xml_url: xmlUrl,
    danfe_url: danfeUrl,
    raw_payload: payload,
    error_code:
      normalizeNullable(payload?.error) ||
      normalizeNullable(payload?.error_code) ||
      normalizeNullable(attributes.status_code),
    error_message:
      normalizeNullable(payload?.message) ||
      normalizeNullable(payload?.error_message) ||
      normalizeNullable(attributes.status_description),
  };
}

function hasAuthorizedInvoiceEvidence(invoice, availability = {}) {
  const hasInvoiceIdentity =
    Boolean(normalizeNullable(invoice?.invoice_number)) &&
    Boolean(normalizeNullable(invoice?.invoice_series)) &&
    Boolean(normalizeNullable(invoice?.invoice_key));
  const hasAuthorizationMetadata =
    Boolean(normalizeNullable(invoice?.authorization_protocol)) ||
    Boolean(normalizeNullable(invoice?.authorized_at));
  const hasMaterializedDocument = Boolean(
    availability.danfeAvailable || availability.xmlAvailable
  );

  return (
    Boolean(availability.syncedWithMercadoLivre) ||
    (hasInvoiceIdentity && hasAuthorizationMetadata) ||
    (Boolean(normalizeNullable(invoice?.invoice_key)) &&
      hasMaterializedDocument &&
      hasAuthorizationMetadata)
  );
}

function mapDocumentStatus(invoice, availability = {}) {
  const status = normalizeState(invoice.status);
  const transactionStatus = normalizeState(invoice.transaction_status);
  const hasAuthorizedEvidence = hasAuthorizedInvoiceEvidence(invoice, availability);

  if (status === "authorized" || transactionStatus === "authorized") {
    return "authorized";
  }

  if (["rejected", "cancelled", "canceled", "denied"].includes(status)) {
    return "rejected";
  }

  if (!status && hasAuthorizedEvidence) {
    return "authorized";
  }

  if (["processing", "pending", "in_process"].includes(status) || ["processing", "pending"].includes(transactionStatus)) {
    return "emitting";
  }

  if (["rejected", "cancelled", "canceled", "denied"].includes(transactionStatus)) {
    return hasAuthorizedEvidence ? "authorized" : "rejected";
  }

  if (status === "error" || transactionStatus === "error") {
    return hasAuthorizedEvidence ? "authorized" : "error";
  }

  if (hasAuthorizedEvidence) {
    return "authorized";
  }

  if (["rejected", "cancelled", "canceled", "denied"].includes(status) || ["rejected", "cancelled", "canceled", "denied"].includes(transactionStatus)) {
    return "rejected";
  }

  return "pending_configuration";
}

function reconcileStoredRecordStatus(record) {
  if (!record) return record;

  const normalizedStatus = normalizeState(record.status);
  if (normalizedStatus === "authorized") {
    return record;
  }

  const hasAuthorizedEvidence = hasAuthorizedInvoiceEvidence(record, {
    danfeAvailable: hasNfeDanfeFile(record),
    xmlAvailable: hasNfeXmlFile(record),
    syncedWithMercadoLivre: record.ml_sync_status === "synced_with_mercadolivre",
  });

  if (!hasAuthorizedEvidence) {
    return record;
  }

  return upsertNfeDocument({
    ...record,
    status: "authorized",
  });
}

async function fetchInvoiceByOrder(context) {
  const connection = await ensureValidAccessToken(context.connection);
  const byOrder = await fetchMercadoLivreJson(
    `https://api.mercadolibre.com/users/${encodeURIComponent(context.seller_id)}/invoices/orders/${encodeURIComponent(context.order_id)}`,
    connection.access_token
  );

  if (byOrder.response.ok && byOrder.payload && typeof byOrder.payload === "object") {
    return {
      connection,
      payload: byOrder.payload,
      lookup: "order",
    };
  }

  if (context.shipment_id) {
    const byShipment = await fetchMercadoLivreJson(
      `https://api.mercadolibre.com/users/${encodeURIComponent(context.seller_id)}/invoices/shipments/${encodeURIComponent(context.shipment_id)}`,
      connection.access_token
    );

    if (byShipment.response.ok && byShipment.payload && typeof byShipment.payload === "object") {
      return {
        connection,
        payload: byShipment.payload,
        lookup: "shipment",
      };
    }
  }

  return {
    connection,
    payload: null,
    lookup: "missing",
    error_status: byOrder.response.status,
    error_payload: byOrder.payload,
  };
}

async function fetchShipmentInvoiceData(context, accessToken) {
  if (!context.shipment_id) {
    return {
      status: "not_applicable",
      payload: null,
    };
  }

  const { response, payload } = await fetchMercadoLivreJson(
    `https://api.mercadolibre.com/shipments/${encodeURIComponent(context.shipment_id)}/invoice_data?siteId=${encodeURIComponent(context.site_id)}`,
    accessToken
  );

  if (response.ok) {
    return {
      status: "available",
      payload,
    };
  }

  return {
    status: response.status === 404 ? "missing" : "error",
    payload,
    http_status: response.status,
  };
}

async function fetchFaturadorErrorDetails(siteId, errorCode, accessToken) {
  const normalizedErrorCode = normalizeNullable(errorCode);
  if (!normalizedErrorCode) return null;

  const { response, payload } = await fetchMercadoLivreJson(
    `https://api.mercadolibre.com/users/invoices/errors/${encodeURIComponent(siteId || DEFAULT_SITE_ID)}/${encodeURIComponent(normalizedErrorCode)}`,
    accessToken
  );

  if (!response.ok || !payload || typeof payload !== "object") {
    return null;
  }

  return payload;
}

function validateGenerationReadiness(context, existingRecord, extraChecks = []) {
  const buyerBilling = getBuyerBillingInfo(context);
  const items = getOrderItems(context.order);
  const isPaidOrder = ["paid", "confirmed"].includes(
    normalizeState(context.order?.order_status)
  );
  const shipmentReady = context.shipment_status === "ready_to_ship";
  const invoicePending = context.shipment_substatus === "invoice_pending";
  const hasBillingInfo = context.billing_info_status === "available";
  const hasBuyerIdentification =
    Boolean(normalizeNullable(buyerBilling.identification.type)) &&
    Boolean(normalizeNullable(buyerBilling.identification.number));
  const hasBuyerAddress =
    Boolean(normalizeNullable(buyerBilling.address.street_name)) &&
    Boolean(normalizeNullable(buyerBilling.address.street_number)) &&
    Boolean(normalizeNullable(buyerBilling.address.city_name)) &&
    Boolean(normalizeNullable(buyerBilling.address.zip_code)) &&
    Boolean(normalizeNullable(buyerBilling.address.country_id));
  const hasAnyItem = items.length > 0;
  const hasItemIdentity = items.some(
    (item) =>
      normalizeNullable(item?.item_id || item?.item?.id || item?.id) ||
      normalizeNullable(item?.item_title || item?.full_unit_name || item?.title)
  );
  const hasPositiveQuantity = items.every((item) => Number(item?.quantity || 0) > 0);

  const checks = [
    buildReadinessCheck({
      key: "existing_authorized_invoice",
      label: "NF-e ainda nao autorizada para este pedido",
      passed: existingRecord?.status !== "authorized",
      value: existingRecord?.status || "none",
    }),
    buildReadinessCheck({
      key: "marketplace_managed",
      label: "Pedido nao e gerido pelo faturamento Full do Mercado Livre",
      passed: context.logistic_type !== "fulfillment",
      value: context.logistic_type || "unknown",
    }),
    // Checks abaixo são INFORMATIVOS (blocking: false).
    // O ML Faturador valida tudo na hora de emitir — se tiver problema
    // real, retorna erro específico. Pré-bloquear aqui impedia NF-e
    // de pedidos que o ML aceitaria normalmente.
    buildReadinessCheck({
      key: "order_identifier",
      label: "Pedido possui identificador do Mercado Livre",
      passed: Boolean(context.order_id),
      blocking: false,
      value: context.order_id,
    }),
    buildReadinessCheck({
      key: "paid_order",
      label: "Pedido esta pago/confirmado",
      passed: isPaidOrder,
      blocking: false,
      value: context.order?.order_status || "unknown",
    }),
    buildReadinessCheck({
      key: "shipment_linked",
      label: "Pedido possui envio vinculado",
      passed: Boolean(context.shipment_id),
      blocking: false,
      value: context.shipment_id,
    }),
    buildReadinessCheck({
      key: "shipment_ready_to_ship",
      label: "Envio esta em ready_to_ship",
      passed: shipmentReady,
      blocking: false,
      value: context.shipment_status || "unknown",
    }),
    buildReadinessCheck({
      key: "shipment_invoice_pending",
      label: "Mercado Livre sinalizou invoice_pending",
      passed: invoicePending,
      blocking: false,
      value: context.shipment_substatus || "none",
      detail:
        "Sem esse substatus, o Faturador ainda pode nao aceitar a solicitacao imediatamente.",
    }),
    buildReadinessCheck({
      key: "billing_info_available",
      label: "Dados fiscais do comprador foram carregados",
      passed: hasBillingInfo,
      blocking: false,
      value: context.billing_info_status || "missing",
    }),
    buildReadinessCheck({
      key: "buyer_identification",
      label: "Comprador possui documento fiscal",
      passed: hasBuyerIdentification,
      blocking: false,
      value: buyerBilling.identification.type || null,
    }),
    buildReadinessCheck({
      key: "buyer_address",
      label: "Comprador possui endereco fiscal minimo",
      passed: hasBuyerAddress,
      blocking: false,
      value: buyerBilling.address.zip_code || null,
    }),
    buildReadinessCheck({
      key: "order_items",
      label: "Pedido possui itens identificaveis",
      passed: hasAnyItem && hasItemIdentity && hasPositiveQuantity,
      blocking: false,
      value: String(items.length),
    }),
    ...extraChecks,
  ];

  if (existingRecord?.status === "authorized") {
    return buildReadinessPayload({
      allowed: false,
      status: "authorized",
      note: "Esta NF-e ja foi autorizada anteriormente.",
      checks,
    });
  }

  if (context.logistic_type === "fulfillment") {
    return buildReadinessPayload({
      allowed: false,
      status: "managed_by_marketplace",
      note:
        "Pedidos Full seguem o faturamento gerenciado pelo Mercado Livre e nao devem ser emitidos manualmente por este botao.",
      checks,
    });
  }

  const blockingReasons = summarizeBlockingChecks(checks);
  if (blockingReasons.length > 0) {
    return buildReadinessPayload({
      allowed: false,
      status: "blocked",
      note: `Emissao bloqueada ate corrigir: ${blockingReasons.join("; ")}.`,
      checks,
    });
  }

  return buildReadinessPayload({
    allowed: true,
    status: "ready_to_emit",
    note:
      "Pedido em invoice_pending no Mercado Livre, apto para disparar a NF-e pelo Faturador.",
    checks,
  });
}

async function fetchSkuFiscalInformationCheck(sku, accessToken) {
  const normalizedSku = normalizeNullable(sku);
  if (!normalizedSku) {
    return null;
  }

  const { response, payload } = await fetchMercadoLivreJson(
    `https://api.mercadolibre.com/items/fiscal_information/${encodeURIComponent(normalizedSku)}`,
    accessToken
  );

  if (response.ok) {
    return buildReadinessCheck({
      key: `sku_fiscal_information:${normalizedSku}`,
      label: `SKU ${normalizedSku} cadastrado no faturador do Mercado Livre`,
      passed: true,
      value: normalizedSku,
    });
  }

  const detail =
    normalizeNullable(payload?.message) ||
    normalizeNullable(payload?.error_code) ||
    `Falha ${response.status}`;
  // SKU não cadastrado no faturador: apenas aviso, NÃO bloqueia.
  // O ML vai validar na hora de emitir — se tiver problema, retorna
  // erro específico. Bloquear aqui impedia NF-e de pedidos válidos.
  return buildReadinessCheck({
    key: `sku_fiscal_information:${normalizedSku}`,
    label: `SKU ${normalizedSku} cadastrado no faturador do Mercado Livre`,
    passed: false,
    blocking: false,
    value: normalizedSku,
    detail,
  });
}

async function fetchCanInvoiceItemCheck(itemId, variationId, accessToken) {
  const normalizedItemId = normalizeNullable(itemId);
  if (!normalizedItemId) {
    return null;
  }

  const normalizedVariationId = normalizeNullable(variationId);
  const url = normalizedVariationId
    ? `https://api.mercadolibre.com/can_invoice/items/${encodeURIComponent(normalizedItemId)}/variations/${encodeURIComponent(normalizedVariationId)}`
    : `https://api.mercadolibre.com/can_invoice/items/${encodeURIComponent(normalizedItemId)}`;
  const { response, payload } = await fetchMercadoLivreJson(url, accessToken);

  if (response.ok) {
    const status = Boolean(payload?.status);
    return buildReadinessCheck({
      key: `item_can_invoice:${normalizedItemId}:${normalizedVariationId || "base"}`,
      label: `Publicacao ${normalizedItemId} apta para faturamento no Mercado Livre`,
      passed: status,
      value: normalizedVariationId ? `${normalizedItemId}/${normalizedVariationId}` : normalizedItemId,
      detail: status ? null : "O ML ainda marca esta publicacao como nao faturavel.",
    });
  }

  return buildReadinessCheck({
    key: `item_can_invoice:${normalizedItemId}:${normalizedVariationId || "base"}`,
    label: `Publicacao ${normalizedItemId} apta para faturamento no Mercado Livre`,
    passed: false,
    blocking: false,
    value: normalizedVariationId ? `${normalizedItemId}/${normalizedVariationId}` : normalizedItemId,
    detail:
      normalizeNullable(payload?.message) ||
      normalizeNullable(payload?.error_code) ||
      `Falha ${response.status} ao consultar can_invoice`,
  });
}

async function buildExternalFiscalChecks(context) {
  const itemReferences = getOrderItemReferences(context.order);
  if (itemReferences.length === 0) {
    return [];
  }

  const connection = await ensureValidAccessToken(context.connection);
  const checks = [];
  const processedSkus = new Set();
  const processedItems = new Set();

  for (const reference of itemReferences) {
    if (reference.sku && !processedSkus.has(reference.sku)) {
      processedSkus.add(reference.sku);
      const skuCheck = await fetchSkuFiscalInformationCheck(reference.sku, connection.access_token);
      if (skuCheck) {
        checks.push(skuCheck);
      }
    }

    const itemCompositeKey = `${reference.item_id || ""}:${reference.variation_id || ""}`;
    if (reference.item_id && !processedItems.has(itemCompositeKey)) {
      processedItems.add(itemCompositeKey);
      const itemCheck = await fetchCanInvoiceItemCheck(
        reference.item_id,
        reference.variation_id,
        connection.access_token
      );
      if (itemCheck) {
        checks.push(itemCheck);
      }
    }
  }

  return checks;
}

async function resolveGenerationReadiness(context, existingRecord) {
  const baseReadiness = validateGenerationReadiness(context, existingRecord);
  if (!baseReadiness.allowed) {
    return baseReadiness;
  }

  const externalChecks = await buildExternalFiscalChecks(context);
  if (externalChecks.length === 0) {
    return baseReadiness;
  }

  return validateGenerationReadiness(context, existingRecord, externalChecks);
}

async function materializeInvoiceFiles(invoice, accessToken) {
  const invoiceId = normalizeNullable(invoice.invoice_id);
  const sellerId = normalizeNullable(invoice.issuer_user_id) || null;
  if (!invoiceId || !sellerId) {
    return {
      danfe_storage_key: null,
      xml_storage_key: null,
      xml_payload: null,
    };
  }

  let danfeStorageKey = null;
  let xmlStorageKey = null;
  let xmlPayload = null;

  if (invoice.danfe_url) {
    try {
      const danfeFile = await fetchBinary(invoice.danfe_url, accessToken, "application/pdf, application/octet-stream");
      danfeStorageKey = saveNfeDanfeFile(sellerId, invoiceId, danfeFile.buffer);
    } catch {
      danfeStorageKey = null;
    }
  }

  if (invoice.xml_url) {
    try {
      const xmlFile = await fetchBinary(invoice.xml_url, accessToken, "application/xml, text/xml, application/octet-stream");
      xmlStorageKey = saveNfeXmlFile(sellerId, invoiceId, xmlFile.buffer);
      xmlPayload = xmlFile.buffer.toString("utf8");
    } catch {
      xmlStorageKey = null;
      xmlPayload = null;
    }
  }

  return {
    danfe_storage_key: danfeStorageKey,
    xml_storage_key: xmlStorageKey,
    xml_payload: xmlPayload,
  };
}

async function persistInvoiceRecord(context, invoiceLookup, options = {}) {
  const invoice = normalizeMeliInvoicePayload(invoiceLookup.payload || {});
  const files = await materializeInvoiceFiles(invoice, invoiceLookup.connection.access_token);
  const syncProbe = await fetchShipmentInvoiceData(context, invoiceLookup.connection.access_token);
  const fiscalKey = normalizeNullable(syncProbe.payload?.fiscal_key);
  const mlSyncStatus =
    invoice.invoice_key && fiscalKey && invoice.invoice_key === fiscalKey
      ? "synced_with_mercadolivre"
      : invoice.invoice_key && context.logistic_type === "fulfillment"
        ? "managed_by_mercado_livre_faturador"
        : "pending_sync";

  return upsertNfeDocument({
    connection_id: context.connection.id,
    seller_id: context.seller_id,
    order_id: context.order_id,
    ml_order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    issuer_user_id: invoice.issuer_user_id || context.seller_id,
    invoice_id: invoice.invoice_id,
    invoice_number: invoice.invoice_number,
    invoice_series: invoice.invoice_series,
    invoice_key: invoice.invoice_key,
    authorization_protocol: invoice.authorization_protocol,
    status: mapDocumentStatus(invoice, {
      danfeAvailable: Boolean(files.danfe_storage_key),
      xmlAvailable: Boolean(files.xml_storage_key),
      syncedWithMercadoLivre: mlSyncStatus === "synced_with_mercadolivre",
    }),
    transaction_status: invoice.transaction_status,
    environment: invoice.environment,
    source: NFE_SOURCE,
    ml_sync_status: mlSyncStatus,
    issued_at: invoice.issued_at,
    authorized_at: invoice.authorized_at,
    xml_payload: files.xml_payload,
    danfe_storage_key: files.danfe_storage_key,
    xml_storage_key: files.xml_storage_key,
    raw_payload: {
      invoice_lookup: invoiceLookup.lookup,
      invoice: invoice.raw_payload,
      shipment_invoice_data: syncProbe.payload,
      ...options.extraRawPayload,
    },
    error_code: null,
    error_message: null,
    last_sync_at: syncProbe.status === "available" ? nowIso() : null,
  });
}

function persistErrorRecord(context, status, errorCode, errorMessage, rawPayload = {}) {
  return upsertNfeDocument({
    connection_id: context.connection.id,
    seller_id: context.seller_id,
    order_id: context.order_id,
    ml_order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    issuer_user_id: context.seller_id,
    status,
    source: NFE_SOURCE,
    ml_sync_status: "pending",
    raw_payload: rawPayload,
    error_code: errorCode,
    error_message: errorMessage,
  });
}

function buildNfeResponse(record, context) {
  const danfeAvailable = hasNfeDanfeFile(record);
  const xmlAvailable = hasNfeXmlFile(record);
  const base = `/api/nfe/file?order_id=${encodeURIComponent(context.order_id)}`;

  return {
    order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    seller_id: context.seller_id,
    source: record?.source || NFE_SOURCE,
    provider: "mercado_livre_faturador",
    status: record?.status || "pending_configuration",
    transaction_status: record?.transaction_status || null,
    environment: record?.environment || null,
    invoice_number: record?.invoice_number || null,
    invoice_series: record?.invoice_series || null,
    invoice_key: record?.invoice_key || null,
    authorization_protocol: record?.authorization_protocol || null,
    issued_at: record?.issued_at || null,
    authorized_at: record?.authorized_at || null,
    ml_sync_status: record?.ml_sync_status || "pending",
    danfe_available: danfeAvailable,
    xml_available: xmlAvailable,
    error_code: record?.error_code || null,
    error_message: record?.error_message || null,
    note:
      record?.error_message ||
      (record?.status === "authorized"
        ? "NF-e autorizada via Mercado Livre Faturador."
        : record?.status === "ready_to_emit"
          ? "Pedido pronto para solicitar emissão de NF-e."
          : record?.status === "blocked"
            ? "A emissão está bloqueada até corrigir os pré-requisitos fiscais do pedido."
          : record?.status === "managed_by_marketplace"
            ? "Este pedido segue faturamento administrado pelo Mercado Livre."
            : "Aguardando ação de emissão ou reconsulta."),
    danfe_view_url: danfeAvailable ? `${base}&variant=danfe&disposition=inline` : null,
    danfe_download_url: danfeAvailable ? `${base}&variant=danfe&disposition=attachment` : null,
    danfe_print_url: danfeAvailable ? `${base}&variant=danfe&disposition=inline&print=1` : null,
    xml_view_url: xmlAvailable ? `${base}&variant=xml&disposition=inline` : null,
    xml_download_url: xmlAvailable ? `${base}&variant=xml&disposition=attachment` : null,
    updated_at: record?.updated_at || null,
  };
}

export async function getNfeDocument(orderId, options = {}) {
  const context = buildContext(orderId);
  const forceRefresh = parseBoolean(options.forceRefresh);
  const existing = reconcileStoredRecordStatus(
    getNfeDocumentByOrderId(context.seller_id, context.order_id)
  );
  const readiness = await resolveGenerationReadiness(context, existing);

  if (existing && !forceRefresh) {
    return {
      status: "ok",
      nfe: buildNfeResponse(existing, context),
      readiness,
    };
  }

  const invoiceLookup = await fetchInvoiceByOrder(context);
  if (invoiceLookup.payload) {
    const record = await persistInvoiceRecord(context, invoiceLookup);
    return {
      status: "ok",
      nfe: buildNfeResponse(record, context),
      readiness: await resolveGenerationReadiness(context, record),
    };
  }

  const record =
    existing ||
    persistErrorRecord(
      context,
      readiness.status,
      invoiceLookup.error_payload?.error || null,
      readiness.note,
      { lookup_error: invoiceLookup.error_payload }
    );

  return {
    status: "ok",
    nfe: buildNfeResponse(record, context),
    readiness,
  };
}

export async function generateNfe(orderId) {
  const context = buildContext(orderId);
  const existingLookup = await fetchInvoiceByOrder(context);

  if (existingLookup.payload) {
    const record = await persistInvoiceRecord(context, existingLookup, {
      extraRawPayload: { generate_mode: "existing_invoice_reused" },
    });
    return {
      status: "ok",
      action: "noop_existing_invoice",
      nfe: buildNfeResponse(record, context),
      readiness: validateGenerationReadiness(context, record),
    };
  }

  const readiness = await resolveGenerationReadiness(
    context,
    getNfeDocumentByOrderId(context.seller_id, context.order_id)
  );
  if (!readiness.allowed) {
    const blocked = persistErrorRecord(context, readiness.status, null, readiness.note, {
      readiness,
    });
    return {
      status: "ok",
      action: "blocked",
      nfe: buildNfeResponse(blocked, context),
      readiness,
    };
  }

  const connection = await ensureValidAccessToken(context.connection);
  const generateResponse = await fetchMercadoLivreJson(
    `https://api.mercadolibre.com/users/${encodeURIComponent(context.seller_id)}/invoices/orders`,
    connection.access_token,
    {
      method: "POST",
      body: {
        orders: context.pack_order_ids,
      },
    }
  );

  if (!generateResponse.response.ok) {
    const errorCode =
      normalizeNullable(generateResponse.payload?.error) ||
      normalizeNullable(generateResponse.payload?.error_code) ||
      normalizeNullable(generateResponse.payload?.cause?.[0]?.code) ||
      normalizeNullable(generateResponse.payload?.cause?.[0]?.error_code);
    const detailedError = await fetchFaturadorErrorDetails(context.site_id, errorCode, connection.access_token);
    const record = persistErrorRecord(
      context,
      errorCode ? "pending_configuration" : "error",
      errorCode,
      normalizeNullable(detailedError?.display_message) ||
        normalizeNullable(generateResponse.payload?.message) ||
        "Falha ao solicitar a emissão de NF-e ao Mercado Livre.",
      {
        generate_payload: generateResponse.payload,
        detailed_error: detailedError,
        pack_order_ids: context.pack_order_ids,
      }
    );

    return {
      status: "ok",
      action: "generate_failed",
      nfe: buildNfeResponse(record, context),
      readiness,
    };
  }

  const invoiceLookup = await fetchInvoiceByOrder(context);
  if (invoiceLookup.payload) {
    const record = await persistInvoiceRecord(context, invoiceLookup, {
      extraRawPayload: {
        generate_payload: generateResponse.payload,
        pack_order_ids: context.pack_order_ids,
      },
    });

    return {
      status: "ok",
      action: "generate_requested",
      nfe: buildNfeResponse(record, context),
      readiness: await resolveGenerationReadiness(context, record),
    };
  }

  const record = persistErrorRecord(
    context,
    "emitting",
    null,
    "Solicitação enviada ao Mercado Livre. A nota ainda não ficou disponível para consulta imediata.",
    {
      generate_payload: generateResponse.payload,
      pack_order_ids: context.pack_order_ids,
    }
  );

  return {
    status: "ok",
    action: "generate_pending_lookup",
    nfe: buildNfeResponse(record, context),
    readiness,
  };
}

export async function syncNfeWithMercadoLivre(orderId) {
  const context = buildContext(orderId);
  const record = reconcileStoredRecordStatus(
    getNfeDocumentByOrderId(context.seller_id, context.order_id)
  );
  if (!record) {
    throw buildNotFoundError("NF-e ainda não foi localizada para este pedido.");
  }

  const connection = await ensureValidAccessToken(context.connection);
  const syncProbe = await fetchShipmentInvoiceData(context, connection.access_token);

  if (
    syncProbe.status === "available" &&
    normalizeNullable(syncProbe.payload?.fiscal_key) &&
    normalizeNullable(syncProbe.payload?.fiscal_key) === normalizeNullable(record.invoice_key)
  ) {
    const updated = upsertNfeDocument({
      ...record,
      ml_sync_status: "synced_with_mercadolivre",
      last_sync_at: nowIso(),
      raw_payload: {
        ...(record.raw_payload || {}),
        shipment_invoice_data: syncProbe.payload,
      },
    });

    return {
      status: "ok",
      sync_action: "already_synced",
      nfe: buildNfeResponse(updated, context),
    };
  }

  if (record.source === NFE_SOURCE) {
    const updated = upsertNfeDocument({
      ...record,
      ml_sync_status: "managed_by_mercado_livre_faturador",
      last_sync_at: syncProbe.status === "available" ? nowIso() : record.last_sync_at,
      raw_payload: {
        ...(record.raw_payload || {}),
        shipment_invoice_data: syncProbe.payload,
      },
    });

    return {
      status: "ok",
      sync_action: "managed_by_mercado_livre_faturador",
      nfe: buildNfeResponse(updated, context),
    };
  }

  return {
    status: "ok",
    sync_action: "pending_manual_sync_strategy",
    nfe: buildNfeResponse(record, context),
  };
}

export async function getNfeFile(orderId, options = {}) {
  const context = buildContext(orderId);
  const variant = normalizeNullable(options.variant) || "danfe";
  const forceRefresh = parseBoolean(options.forceRefresh);
  const payload = await getNfeDocument(orderId, { forceRefresh });
  const record = reconcileStoredRecordStatus(
    getNfeDocumentByOrderId(context.seller_id, context.order_id)
  );

  if (!record) {
    throw buildNotFoundError("NF-e ainda não está disponível para este pedido.");
  }

  if (variant === "xml") {
    const xmlBuffer = readNfeXmlFile(record);
    if (!xmlBuffer) {
      throw buildNotFoundError("XML autorizado ainda não está disponível.");
    }

    return {
      buffer: xmlBuffer,
      contentType: "application/xml",
      fileName: `nfe-${payload.nfe.invoice_number || context.order_id}.xml`,
    };
  }

  const danfeBuffer = readNfeDanfeFile(record);
  if (!danfeBuffer) {
    throw buildNotFoundError("DANFE ainda não está disponível.");
  }

  return {
    buffer: danfeBuffer,
    contentType: "application/pdf",
    fileName: `danfe-${payload.nfe.invoice_number || context.order_id}.pdf`,
  };
}

function buildOrderIndexesForNotifications(sellerId) {
  const rows = getOrders();
  const ordersByShipmentId = new Map();
  const ordersByInvoiceId = new Map();

  for (const row of rows) {
    const rawData = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
    const shipmentId =
      normalizeNullable(row.shipping_id) ||
      normalizeNullable(rawData.shipping_id) ||
      normalizeNullable(rawData.shipment_snapshot?.id);

    if (shipmentId && row.order_id && !ordersByShipmentId.has(shipmentId)) {
      ordersByShipmentId.set(shipmentId, String(row.order_id));
    }
  }

  const nfeDocuments = listNfeDocumentsBySellerId(sellerId, null);
  for (const record of nfeDocuments) {
    const invoiceId = normalizeNullable(record.invoice_id);
    if (invoiceId && record.order_id && !ordersByInvoiceId.has(invoiceId)) {
      ordersByInvoiceId.set(invoiceId, String(record.order_id));
    }
  }

  return {
    ordersByShipmentId,
    ordersByInvoiceId,
  };
}

function collectReferenceIds(value, refs = { orderIds: new Set(), shipmentIds: new Set(), invoiceIds: new Set() }) {
  if (value == null) {
    return refs;
  }

  if (typeof value === "string") {
    const orderMatch = value.match(/\/orders\/(\d+)/i);
    const shipmentMatch = value.match(/\/shipments\/(\d+)/i);
    const invoiceMatch = value.match(/\/invoices\/(\d+)/i);
    if (orderMatch) refs.orderIds.add(orderMatch[1]);
    if (shipmentMatch) refs.shipmentIds.add(shipmentMatch[1]);
    if (invoiceMatch) refs.invoiceIds.add(invoiceMatch[1]);
    return refs;
  }

  if (typeof value !== "object") {
    return refs;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectReferenceIds(entry, refs);
    }
    return refs;
  }

  const orderId = normalizeNullable(
    value.order_id || value.orderId || value.order?.id || value.order?.order_id
  );
  const shipmentId = normalizeNullable(
    value.shipment_id || value.shipmentId || value.shipment?.id
  );
  const invoiceId = normalizeNullable(
    value.invoice_id || value.invoiceId || value.invoice?.id
  );

  if (orderId) refs.orderIds.add(orderId);
  if (shipmentId) refs.shipmentIds.add(shipmentId);
  if (invoiceId) refs.invoiceIds.add(invoiceId);

  for (const child of Object.values(value)) {
    collectReferenceIds(child, refs);
  }

  return refs;
}

function resolveOrderIdsFromNotificationPayload(payload, sellerId) {
  const refs = collectReferenceIds(payload);
  const indexes = buildOrderIndexesForNotifications(sellerId);
  const orderIds = new Set(refs.orderIds);

  for (const shipmentId of refs.shipmentIds) {
    const orderId = indexes.ordersByShipmentId.get(shipmentId);
    if (orderId) {
      orderIds.add(orderId);
    }
  }

  for (const invoiceId of refs.invoiceIds) {
    const orderId = indexes.ordersByInvoiceId.get(invoiceId);
    if (orderId) {
      orderIds.add(orderId);
    }
  }

  return [...orderIds].filter(Boolean);
}

export async function refreshNfeFromNotification(payload = {}, options = {}) {
  const sellerId =
    normalizeNullable(options.sellerId) ||
    normalizeNullable(payload?.user_id) ||
    (() => {
      const resource = normalizeNullable(payload?.resource);
      const matched = resource?.match(/\/users\/(\d+)/i);
      return matched?.[1] || null;
    })();

  if (!sellerId) {
    return {
      status: "ignored",
      reason: "seller_id_missing",
      order_ids: [],
      refreshed: 0,
    };
  }

  const orderIds = resolveOrderIdsFromNotificationPayload(payload, sellerId);

  if (orderIds.length === 0) {
    return {
      status: "ignored",
      reason: "order_reference_not_found",
      order_ids: [],
      refreshed: 0,
    };
  }

  const refreshedRecords = [];
  for (const orderId of orderIds) {
    const result = await getNfeDocument(orderId, { forceRefresh: true });
    refreshedRecords.push({
      order_id: orderId,
      status: result?.nfe?.status || result?.status || "unknown",
      ml_sync_status: result?.nfe?.ml_sync_status || null,
    });
  }

  return {
    status: "ok",
    reason: "invoice_notification_processed",
    order_ids: orderIds,
    refreshed: refreshedRecords.length,
    records: refreshedRecords,
  };
}

export const __nfeTestables = {
  buildReadinessPayload,
  collectReferenceIds,
  mapDocumentStatus,
  normalizeMeliInvoicePayload,
  resolveOrderIdsFromNotificationPayload,
  validateGenerationReadiness,
};
