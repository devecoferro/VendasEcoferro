import path from "node:path";

import { ensureValidAccessToken } from "./mercado-livre.js";
import { getLatestConnection, getOrderRowsByOrderId } from "./storage.js";
import { consolidateOrders } from "../orders.js";
import {
  buildInvoiceStorageKey,
  buildShippingLabelStorageKey,
  documentFileExists,
  getInvoiceDocument,
  getShippingLabelDocument,
  readDocumentFile,
  upsertInvoiceDocument,
  upsertShippingLabelDocument,
  writeDocumentFile,
} from "./document-storage.js";

const SHIPPING_LABEL_SOURCE = "mercado_livre_shipment_labels";
const INVOICE_SOURCE_ORDER = "mercado_livre_invoices_order";
const INVOICE_SOURCE_SHIPMENT = "mercado_livre_invoices_shipment";

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeState(value, fallback = "") {
  const normalized = normalizeNullable(value)?.toLowerCase() || "";
  return normalized || fallback;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "y"].includes(normalized);
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

function getBillingInfoSnapshot(order) {
  const rawData = getRawData(order);
  return rawData.billing_info_snapshot && typeof rawData.billing_info_snapshot === "object"
    ? rawData.billing_info_snapshot
    : {};
}

function getBillingInfoStatus(order) {
  return normalizeState(getRawData(order).billing_info_status, "unknown");
}

function findFirstDeepValue(root, predicate) {
  if (root == null) {
    return null;
  }

  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findFirstDeepValue(entry, predicate);
      if (found != null) {
        return found;
      }
    }
    return null;
  }

  if (typeof root !== "object") {
    return predicate(root) ? root : null;
  }

  if (predicate(root)) {
    return root;
  }

  for (const value of Object.values(root)) {
    const found = findFirstDeepValue(value, predicate);
    if (found != null) {
      return found;
    }
  }

  return null;
}

function findFirstStringByKeys(root, keys) {
  const keySet = new Set(keys);
  const found = findFirstDeepValue(root, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    return Object.entries(value).some(
      ([key, entryValue]) => keySet.has(key) && typeof entryValue === "string" && entryValue.trim()
    );
  });

  if (!found || typeof found !== "object" || Array.isArray(found)) {
    return null;
  }

  for (const key of keys) {
    if (typeof found[key] === "string" && found[key].trim()) {
      return found[key].trim();
    }
  }

  return null;
}

function inferExtensionFromContentType(contentType, fallback = "bin") {
  const normalized = normalizeState(contentType);
  if (normalized.includes("pdf")) return "pdf";
  if (normalized.includes("xml")) return "xml";
  if (normalized.includes("zip")) return "zip";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  return fallback;
}

function inferContentTypeFromExtension(extension, fallback = "application/octet-stream") {
  const normalized = normalizeState(extension);
  if (normalized === "pdf") return "application/pdf";
  if (normalized === "xml") return "application/xml";
  if (normalized === "zip") return "application/zip";
  if (normalized === "png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  return fallback;
}

function parseContentDispositionFilename(contentDisposition) {
  const normalized = normalizeNullable(contentDisposition);
  if (!normalized) {
    return null;
  }

  const utf8Match = normalized.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]).trim();
  }

  const quotedMatch = normalized.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  const plainMatch = normalized.match(/filename=([^;]+)/i);
  if (plainMatch) {
    return plainMatch[1].trim();
  }

  return null;
}

function bufferFromArrayBuffer(arrayBuffer) {
  return Buffer.from(arrayBuffer);
}

function buildExternalDocumentContext(orderId) {
  const normalizedOrderId = normalizeNullable(orderId);
  if (!normalizedOrderId) {
    throw buildNotFoundError("order_id é obrigatório para buscar os documentos.");
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
  const packId = normalizeNullable(rawData.pack_id);
  const shipmentId = normalizeNullable(order.shipping_id || rawData.shipping_id || shipmentSnapshot.id);
  const logisticType = normalizeState(shipmentSnapshot.logistic_type || rawData.deposit_snapshot?.logistic_type);

  return {
    connection,
    seller_id: String(connection.seller_id),
    order,
    order_id: normalizedOrderId,
    shipment_id: shipmentId,
    pack_id: packId,
    logistic_type: logisticType,
    billing_info_status: getBillingInfoStatus(order),
    billing_info_snapshot: getBillingInfoSnapshot(order),
  };
}

async function fetchMercadoLivreJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("json");
  const payload = isJson ? await response.json().catch(() => null) : await response.text().catch(() => null);

  return { response, payload };
}

async function fetchBinaryUrl(url, options = {}) {
  const headers = {
    Accept: options.accept || "*/*",
  };

  if (options.accessToken && url.startsWith("https://api.mercadolibre.com/")) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Falha ao baixar documento externo (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: bufferFromArrayBuffer(arrayBuffer),
    contentType: response.headers.get("content-type") || options.defaultContentType || "application/octet-stream",
    fileName:
      parseContentDispositionFilename(response.headers.get("content-disposition")) ||
      null,
  };
}

export function extractInvoiceMetadataFromXml(xmlString) {
  const normalizedXml = typeof xmlString === "string" ? xmlString : "";
  if (!normalizedXml) {
    return {
      invoice_number: null,
      invoice_key: null,
    };
  }

  const invoiceNumberMatch = normalizedXml.match(/<nNF>([^<]+)<\/nNF>/i);
  const invoiceKeyMatch =
    normalizedXml.match(/<chNFe>([^<]+)<\/chNFe>/i) ||
    normalizedXml.match(/Id=\"NFe(\d{44})\"/i);

  return {
    invoice_number: invoiceNumberMatch?.[1]?.trim() || null,
    invoice_key: invoiceKeyMatch?.[1]?.trim() || null,
  };
}

function buildShippingLabelUrls(orderId) {
  const base = `/api/ml/order-documents/file?order_id=${encodeURIComponent(orderId)}&type=shipping_label_external`;
  return {
    view_url: `${base}&disposition=inline`,
    download_url: `${base}&disposition=attachment`,
    print_url: `${base}&disposition=inline&print=1`,
  };
}

function buildInvoiceUrls(orderId) {
  const base = `/api/ml/order-documents/file?order_id=${encodeURIComponent(orderId)}&type=invoice_nfe_document`;
  return {
    danfe_view_url: `${base}&variant=danfe&disposition=inline`,
    danfe_download_url: `${base}&variant=danfe&disposition=attachment`,
    danfe_print_url: `${base}&variant=danfe&disposition=inline&print=1`,
    xml_download_url: `${base}&variant=xml&disposition=attachment`,
    xml_view_url: `${base}&variant=xml&disposition=inline`,
  };
}

function buildInternalLabelExisting(orderId) {
  return {
    status: "available",
    flow: "review_pdf_export",
    note:
      "Etiqueta PDF interna já existente no fluxo de conferência. Ela continua separada dos documentos oficiais externos.",
    route: "/review",
    order_id: orderId,
  };
}

function buildShippingLabelResponse(record, context, cacheHit) {
  if (!record) {
    return {
      status: "unavailable",
      source: SHIPPING_LABEL_SOURCE,
      fetched_at: null,
      label_format: null,
      note:
        context.logistic_type === "fulfillment"
          ? "O endpoint oficial de shipment_labels não gera etiqueta pública para pedidos Full."
          : "Etiqueta oficial de expedição ainda não localizada no Mercado Livre para este envio.",
    };
  }

  const hasFile = documentFileExists(record.storage_key);
  const fileUrls = buildShippingLabelUrls(context.order_id);

  return {
    status: hasFile ? "available" : "unavailable",
    source: record.source,
    fetched_at: record.fetched_at,
    label_format: record.label_format,
    label_content_type: record.label_content_type,
    cache_hit: cacheHit,
    note:
      record.label_payload?.error_message ||
      (hasFile
        ? "Etiqueta oficial de expedição disponível separadamente da etiqueta interna."
        : "Etiqueta oficial ainda não disponível para este envio."),
    view_url: hasFile ? fileUrls.view_url : null,
    download_url: hasFile ? fileUrls.download_url : null,
    print_url: hasFile ? fileUrls.print_url : null,
  };
}

function buildInvoiceResponse(record, context, cacheHit) {
  if (!record) {
    return {
      status: "unavailable",
      source: INVOICE_SOURCE_ORDER,
      fetched_at: null,
      invoice_number: null,
      invoice_key: null,
      danfe_available: false,
      xml_available: false,
      note:
        context.billing_info_status === "available"
          ? "Há billing_info na venda, mas a NF-e oficial não foi localizada via API de invoices do Mercado Livre."
          : "NF-e oficial ainda não localizada no Mercado Livre para este pedido.",
    };
  }

  const danfeAvailable = documentFileExists(record.danfe_storage_key);
  const xmlAvailable = documentFileExists(record.xml_storage_key);
  const urls = buildInvoiceUrls(context.order_id);

  return {
    status: danfeAvailable || xmlAvailable ? (danfeAvailable && xmlAvailable ? "available" : "partial") : "unavailable",
    source: record.source,
    fetched_at: record.fetched_at,
    invoice_number: record.invoice_number,
    invoice_key: record.invoice_key,
    danfe_available: danfeAvailable,
    xml_available: xmlAvailable,
    cache_hit: cacheHit,
    note:
      record.invoice_payload?.error_message ||
      (danfeAvailable || xmlAvailable
        ? "Documento fiscal localizado e mantido separado da etiqueta interna."
        : "Documento fiscal não pôde ser materializado em arquivo local."),
    danfe_view_url: danfeAvailable ? urls.danfe_view_url : null,
    danfe_download_url: danfeAvailable ? urls.danfe_download_url : null,
    danfe_print_url: danfeAvailable ? urls.danfe_print_url : null,
    xml_view_url: xmlAvailable ? urls.xml_view_url : null,
    xml_download_url: xmlAvailable ? urls.xml_download_url : null,
  };
}

async function fetchShippingLabelRecord(context, forceRefresh = false) {
  if (!context.shipment_id) {
    return {
      record: null,
      cache_hit: false,
    };
  }

  const cachedRecord = getShippingLabelDocument({
    sellerId: context.seller_id,
    shipmentId: context.shipment_id,
  });
  const cachedUsable = cachedRecord && documentFileExists(cachedRecord.storage_key);
  if (cachedUsable && !forceRefresh) {
    return {
      record: cachedRecord,
      cache_hit: true,
    };
  }

  if (context.logistic_type === "fulfillment") {
    return {
      record: cachedRecord,
      cache_hit: false,
    };
  }

  const connection = await ensureValidAccessToken(context.connection);
  const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${encodeURIComponent(
    context.shipment_id
  )}&response_type=pdf`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      Accept: "application/pdf, application/octet-stream, application/zip",
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const record = upsertShippingLabelDocument({
      connection_id: context.connection.id,
      seller_id: context.seller_id,
      order_id: context.order_id,
      shipment_id: context.shipment_id,
      pack_id: context.pack_id,
      source: SHIPPING_LABEL_SOURCE,
      label_payload: {
        request_url: url,
        error_status: response.status,
        error_message: details || "shipment_label_fetch_failed",
      },
      fetched_at: nowIso(),
    });

    return {
      record,
      cache_hit: false,
    };
  }

  const contentType = response.headers.get("content-type") || "application/pdf";
  const fileName =
    parseContentDispositionFilename(response.headers.get("content-disposition")) ||
    `shipment-${context.shipment_id}.${inferExtensionFromContentType(contentType, "pdf")}`;
  const extension = inferExtensionFromContentType(contentType, path.extname(fileName).replace(/^\./, "") || "pdf");
  const storageKey = buildShippingLabelStorageKey(context.seller_id, context.shipment_id, extension);
  const buffer = bufferFromArrayBuffer(await response.arrayBuffer());
  writeDocumentFile(storageKey, buffer);

  const record = upsertShippingLabelDocument({
    connection_id: context.connection.id,
    seller_id: context.seller_id,
    order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    source: SHIPPING_LABEL_SOURCE,
    label_format: extension,
    label_content_type: contentType,
    label_url: url,
    label_payload: {
      request_url: url,
      file_name: fileName,
      content_length: buffer.length,
    },
    storage_key: storageKey,
    fetched_at: nowIso(),
  });

  return {
    record,
    cache_hit: false,
  };
}

function extractInvoicePayloadMetadata(payload) {
  const pdfUrl =
    findFirstStringByKeys(payload, ["pdf_download_link", "pdf_url", "danfe_location"]) || null;
  const xmlUrl =
    findFirstStringByKeys(payload, ["xml_location", "xml_url"]) || null;
  const invoiceKey =
    findFirstStringByKeys(payload, ["invoice_key", "fiscal_key", "access_key", "key"]) || null;
  const invoiceNumber =
    findFirstStringByKeys(payload, ["invoice_number", "number", "fiscal_number"]) || null;
  const invoiceId =
    normalizeNullable(payload?.id) ||
    normalizeNullable(payload?.invoice_id) ||
    normalizeNullable(findFirstStringByKeys(payload, ["invoice_id"]));

  return {
    invoiceId,
    invoiceNumber,
    invoiceKey,
    pdfUrl,
    xmlUrl,
  };
}

async function fetchInvoiceFromMercadoLivre(context) {
  const connection = await ensureValidAccessToken(context.connection);
  const candidates = [
    context.order_id
      ? {
          source: INVOICE_SOURCE_ORDER,
          url: `https://api.mercadolibre.com/users/${encodeURIComponent(
            context.seller_id
          )}/invoices/orders/${encodeURIComponent(context.order_id)}`,
        }
      : null,
    context.shipment_id
      ? {
          source: INVOICE_SOURCE_SHIPMENT,
          url: `https://api.mercadolibre.com/users/${encodeURIComponent(
            context.seller_id
          )}/invoices/shipments/${encodeURIComponent(context.shipment_id)}`,
        }
      : null,
  ].filter(Boolean);

  let lastError = null;

  for (const candidate of candidates) {
    const { response, payload } = await fetchMercadoLivreJson(candidate.url, connection.access_token);

    if (response.ok && payload && typeof payload === "object") {
      return {
        source: candidate.source,
        payload,
        access_token: connection.access_token,
      };
    }

    if (response.status === 404) {
      lastError = {
        source: candidate.source,
        error_status: response.status,
        error_message: "invoice_not_found",
      };
      continue;
    }

    const errorMessage =
      typeof payload === "string"
        ? payload
        : payload?.message || payload?.error || `invoice_fetch_failed_${response.status}`;

    lastError = {
      source: candidate.source,
      error_status: response.status,
      error_message: errorMessage,
    };

    if (response.status === 401 || response.status === 403) {
      break;
    }
  }

  return {
    source: candidates[0]?.source || INVOICE_SOURCE_ORDER,
    payload: null,
    access_token: connection.access_token,
    error: lastError,
  };
}

async function materializeInvoiceFiles(metadata, accessToken, sellerId, recordBaseName) {
  let danfeStorageKey = null;
  let danfeContentType = null;
  let xmlStorageKey = null;
  let xmlContentType = null;
  let extractedInvoiceNumber = metadata.invoiceNumber || null;
  let extractedInvoiceKey = metadata.invoiceKey || null;

  if (metadata.pdfUrl) {
    try {
      const pdfFile = await fetchBinaryUrl(metadata.pdfUrl, {
        accessToken,
        accept: "application/pdf, application/octet-stream",
        defaultContentType: "application/pdf",
      });
      const pdfExtension = inferExtensionFromContentType(pdfFile.contentType, "pdf");
      danfeStorageKey = buildInvoiceStorageKey(sellerId, `${recordBaseName}-danfe`, pdfExtension);
      writeDocumentFile(danfeStorageKey, pdfFile.buffer);
      danfeContentType = pdfFile.contentType;
    } catch {
      danfeStorageKey = null;
      danfeContentType = null;
    }
  }

  if (metadata.xmlUrl) {
    try {
      const xmlFile = await fetchBinaryUrl(metadata.xmlUrl, {
        accessToken,
        accept: "application/xml, text/xml, application/octet-stream",
        defaultContentType: "application/xml",
      });
      const xmlExtension = inferExtensionFromContentType(xmlFile.contentType, "xml");
      xmlStorageKey = buildInvoiceStorageKey(sellerId, `${recordBaseName}-xml`, xmlExtension);
      writeDocumentFile(xmlStorageKey, xmlFile.buffer);
      xmlContentType = xmlFile.contentType;

      const xmlText = xmlFile.buffer.toString("utf8");
      const xmlMetadata = extractInvoiceMetadataFromXml(xmlText);
      extractedInvoiceNumber = extractedInvoiceNumber || xmlMetadata.invoice_number;
      extractedInvoiceKey = extractedInvoiceKey || xmlMetadata.invoice_key;
    } catch {
      xmlStorageKey = null;
      xmlContentType = null;
    }
  }

  return {
    danfeStorageKey,
    danfeContentType,
    xmlStorageKey,
    xmlContentType,
    invoiceNumber: extractedInvoiceNumber,
    invoiceKey: extractedInvoiceKey,
  };
}

async function fetchInvoiceRecord(context, forceRefresh = false) {
  const cachedRecord = getInvoiceDocument({
    sellerId: context.seller_id,
    orderId: context.order_id,
    shipmentId: context.shipment_id,
    packId: context.pack_id,
  });
  const cachedUsable =
    cachedRecord &&
    (documentFileExists(cachedRecord.danfe_storage_key) ||
      documentFileExists(cachedRecord.xml_storage_key));

  if (cachedUsable && !forceRefresh) {
    return {
      record: cachedRecord,
      cache_hit: true,
    };
  }

  const invoiceResult = await fetchInvoiceFromMercadoLivre(context);

  if (!invoiceResult.payload || typeof invoiceResult.payload !== "object") {
    const record = upsertInvoiceDocument({
      connection_id: context.connection.id,
      seller_id: context.seller_id,
      order_id: context.order_id,
      shipment_id: context.shipment_id,
      pack_id: context.pack_id,
      source: invoiceResult.source,
      invoice_payload: {
        billing_info_status: context.billing_info_status,
        billing_info_snapshot: context.billing_info_snapshot,
        ...(invoiceResult.error || { error_message: "invoice_not_found" }),
      },
      fetched_at: nowIso(),
    });

    return {
      record,
      cache_hit: false,
    };
  }

  const metadata = extractInvoicePayloadMetadata(invoiceResult.payload);
  const recordBaseName =
    metadata.invoiceId ||
    context.order_id ||
    context.shipment_id ||
    context.pack_id ||
    "invoice";
  const files = await materializeInvoiceFiles(
    metadata,
    invoiceResult.access_token,
    context.seller_id,
    recordBaseName
  );

  const record = upsertInvoiceDocument({
    connection_id: context.connection.id,
    seller_id: context.seller_id,
    order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    invoice_id: metadata.invoiceId,
    source: invoiceResult.source,
    invoice_number: files.invoiceNumber,
    invoice_key: files.invoiceKey,
    invoice_url: metadata.pdfUrl,
    xml_url: metadata.xmlUrl,
    invoice_content_type: files.danfeContentType,
    xml_content_type: files.xmlContentType,
    invoice_payload: invoiceResult.payload,
    danfe_storage_key: files.danfeStorageKey,
    xml_storage_key: files.xmlStorageKey,
    fetched_at: nowIso(),
  });

  return {
    record,
    cache_hit: false,
  };
}

export async function getOrderDocuments(orderId, options = {}) {
  const context = buildExternalDocumentContext(orderId);
  const forceRefresh = parseBoolean(options.forceRefresh);

  const shippingLabelResult = await fetchShippingLabelRecord(context, forceRefresh);
  const invoiceResult = await fetchInvoiceRecord(context, forceRefresh);

  return {
    status: "ok",
    order_id: context.order_id,
    shipment_id: context.shipment_id,
    pack_id: context.pack_id,
    seller_id: context.seller_id,
    internal_label_existing: buildInternalLabelExisting(context.order_id),
    shipping_label_external: buildShippingLabelResponse(
      shippingLabelResult.record,
      context,
      shippingLabelResult.cache_hit
    ),
    invoice_nfe_document: buildInvoiceResponse(
      invoiceResult.record,
      context,
      invoiceResult.cache_hit
    ),
  };
}

export async function getOrderDocumentBinary(orderId, options = {}) {
  const context = buildExternalDocumentContext(orderId);
  const forceRefresh = parseBoolean(options.forceRefresh);
  const type = normalizeNullable(options.type);
  const variant = normalizeNullable(options.variant) || "danfe";

  if (type === "shipping_label_external") {
    const { record } = await fetchShippingLabelRecord(context, forceRefresh);
    if (!record || !documentFileExists(record.storage_key)) {
      throw buildNotFoundError("Etiqueta oficial de expedição ainda não está disponível.");
    }

    const buffer = readDocumentFile(record.storage_key);
    if (!buffer) {
      throw buildNotFoundError("Arquivo da etiqueta oficial não encontrado no cache local.");
    }

    const extension =
      normalizeNullable(record.label_format) ||
      inferExtensionFromContentType(record.label_content_type, "pdf");

    return {
      buffer,
      contentType:
        normalizeNullable(record.label_content_type) ||
        inferContentTypeFromExtension(extension, "application/pdf"),
      fileName: `shipping-label-${context.shipment_id}.${extension}`,
    };
  }

  if (type === "invoice_nfe_document") {
    const { record } = await fetchInvoiceRecord(context, forceRefresh);
    if (!record) {
      throw buildNotFoundError("NF-e ainda não está disponível para este pedido.");
    }

    const storageKey =
      variant === "xml" ? record.xml_storage_key : record.danfe_storage_key;
    const contentType =
      variant === "xml" ? record.xml_content_type : record.invoice_content_type;
    const extension = inferExtensionFromContentType(
      contentType,
      variant === "xml" ? "xml" : "pdf"
    );
    const buffer = readDocumentFile(storageKey);

    if (!buffer) {
      throw buildNotFoundError(
        variant === "xml"
          ? "XML da NF-e ainda não está disponível."
          : "DANFE da NF-e ainda não está disponível."
      );
    }

    const baseName = record.invoice_number || record.invoice_id || context.order_id;
    return {
      buffer,
      contentType:
        normalizeNullable(contentType) ||
        inferContentTypeFromExtension(extension, "application/octet-stream"),
      fileName:
        variant === "xml"
          ? `nfe-${baseName}.xml`
          : `nfe-${baseName}.${extension}`,
    };
  }

  const error = new Error("Tipo de documento não suportado.");
  error.statusCode = 400;
  throw error;
}
