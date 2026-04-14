import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { DATA_DIR } from "../../_lib/app-config.js";
import { db } from "../../_lib/db.js";

const SHIPPING_LABELS_DIR = path.join(DATA_DIR, "documents", "shipping-labels");
const INVOICES_DIR = path.join(DATA_DIR, "documents", "invoices");

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseJsonSafely(value, fallback = null) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureDocumentsDirectories() {
  fs.mkdirSync(SHIPPING_LABELS_DIR, { recursive: true });
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

function toRelativeStorageKey(...segments) {
  return path.join(...segments).replace(/\\/g, "/");
}

export function resolveDocumentPath(storageKey) {
  const normalized = normalizeNullable(storageKey);
  if (!normalized) {
    return null;
  }

  return path.join(DATA_DIR, normalized.replace(/\//g, path.sep));
}

export function documentFileExists(storageKey) {
  const filePath = resolveDocumentPath(storageKey);
  return Boolean(filePath && fs.existsSync(filePath));
}

export function writeDocumentFile(storageKey, contentBuffer) {
  ensureDocumentsDirectories();

  const filePath = resolveDocumentPath(storageKey);
  if (!filePath) {
    throw new Error("Storage key invalida para salvar documento.");
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contentBuffer);
  return filePath;
}

export function readDocumentFile(storageKey) {
  const filePath = resolveDocumentPath(storageKey);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath);
}

function mapShippingLabelRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    connection_id: row.connection_id,
    seller_id: row.seller_id,
    document_key: row.document_key,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    pack_id: row.pack_id,
    source: row.source,
    label_format: row.label_format,
    label_content_type: row.label_content_type,
    label_url: row.label_url,
    label_payload: parseJsonSafely(row.label_payload, {}),
    storage_key: row.storage_key,
    fetched_at: row.fetched_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapInvoiceRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    connection_id: row.connection_id,
    seller_id: row.seller_id,
    document_key: row.document_key,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    pack_id: row.pack_id,
    invoice_id: row.invoice_id,
    source: row.source,
    invoice_number: row.invoice_number,
    invoice_key: row.invoice_key,
    invoice_url: row.invoice_url,
    xml_url: row.xml_url,
    invoice_content_type: row.invoice_content_type,
    xml_content_type: row.xml_content_type,
    invoice_payload: parseJsonSafely(row.invoice_payload, {}),
    danfe_storage_key: row.danfe_storage_key,
    xml_storage_key: row.xml_storage_key,
    fetched_at: row.fetched_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function buildShippingLabelStorageKey(sellerId, shipmentId, extension) {
  const normalizedExtension = normalizeNullable(extension) || "pdf";
  return toRelativeStorageKey(
    "documents",
    "shipping-labels",
    String(sellerId),
    `${String(shipmentId)}.${normalizedExtension}`
  );
}

export function buildInvoiceStorageKey(sellerId, baseName, extension) {
  const normalizedExtension = normalizeNullable(extension) || "pdf";
  return toRelativeStorageKey(
    "documents",
    "invoices",
    String(sellerId),
    `${String(baseName)}.${normalizedExtension}`
  );
}

export function getShippingLabelDocument(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const shipmentId = normalizeNullable(options.shipmentId);

  if (!sellerId || !shipmentId) {
    return null;
  }

  return mapShippingLabelRow(
    db
      .prepare(
        `SELECT * FROM ml_shipping_label_documents
         WHERE seller_id = ?
           AND shipment_id = ?
         ORDER BY datetime(updated_at) DESC
         LIMIT 1`
      )
      .get(sellerId, shipmentId)
  );
}

export function getInvoiceDocument(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const orderId = normalizeNullable(options.orderId);
  const shipmentId = normalizeNullable(options.shipmentId);
  const packId = normalizeNullable(options.packId);

  if (!sellerId || (!orderId && !shipmentId && !packId)) {
    return null;
  }

  const row =
    (orderId
      ? db
          .prepare(
            `SELECT * FROM ml_invoice_documents
             WHERE seller_id = ?
               AND order_id = ?
             ORDER BY datetime(updated_at) DESC
             LIMIT 1`
          )
          .get(sellerId, orderId)
      : null) ||
    (shipmentId
      ? db
          .prepare(
            `SELECT * FROM ml_invoice_documents
             WHERE seller_id = ?
               AND shipment_id = ?
             ORDER BY datetime(updated_at) DESC
             LIMIT 1`
          )
          .get(sellerId, shipmentId)
      : null) ||
    (packId
      ? db
          .prepare(
            `SELECT * FROM ml_invoice_documents
             WHERE seller_id = ?
               AND pack_id = ?
             ORDER BY datetime(updated_at) DESC
             LIMIT 1`
          )
          .get(sellerId, packId)
      : null);

  return mapInvoiceRow(row);
}

/**
 * Retorna conjuntos com os identificadores (order_id, shipment_id, pack_id)
 * que ja possuem NFe emitida (invoice_key preenchida) na tabela
 * ml_invoice_documents. Usado pelas rotas de dashboard/orders para
 * identificar pedidos que ainda chegam do ML como "invoice_pending"
 * mas que de fato ja tiveram a NFe emitida no nosso sistema (ou que
 * voltaram do ML com a chave da NFe ja vinculada).
 */
export function getEmittedInvoiceLookup(sellerId) {
  const normalizedSellerId = normalizeNullable(sellerId);
  const result = {
    orderIds: new Set(),
    shipmentIds: new Set(),
    packIds: new Set(),
  };
  if (!normalizedSellerId) {
    return result;
  }

  const rows = db
    .prepare(
      `SELECT order_id, shipment_id, pack_id
         FROM ml_invoice_documents
        WHERE seller_id = ?
          AND COALESCE(NULLIF(TRIM(invoice_key), ''), NULLIF(TRIM(invoice_number), '')) IS NOT NULL`
    )
    .all(normalizedSellerId);

  for (const row of rows) {
    if (row.order_id) result.orderIds.add(String(row.order_id));
    if (row.shipment_id) result.shipmentIds.add(String(row.shipment_id));
    if (row.pack_id) result.packIds.add(String(row.pack_id));
  }

  return result;
}

export function upsertShippingLabelDocument(record) {
  const sellerId = normalizeNullable(record.seller_id);
  const shipmentId = normalizeNullable(record.shipment_id);
  const documentKey =
    normalizeNullable(record.document_key) ||
    (sellerId && shipmentId ? `shipment_label:${sellerId}:${shipmentId}` : null);

  if (!sellerId || !shipmentId || !documentKey) {
    throw new Error("Dados insuficientes para salvar a etiqueta externa.");
  }

  const existing = db
    .prepare(
      `SELECT id, created_at FROM ml_shipping_label_documents
       WHERE document_key = ?
       LIMIT 1`
    )
    .get(documentKey);

  db.prepare(
    `INSERT INTO ml_shipping_label_documents (
      id,
      connection_id,
      seller_id,
      document_key,
      order_id,
      shipment_id,
      pack_id,
      source,
      label_format,
      label_content_type,
      label_url,
      label_payload,
      storage_key,
      fetched_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @seller_id,
      @document_key,
      @order_id,
      @shipment_id,
      @pack_id,
      @source,
      @label_format,
      @label_content_type,
      @label_url,
      @label_payload,
      @storage_key,
      @fetched_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(document_key) DO UPDATE SET
      connection_id = excluded.connection_id,
      order_id = excluded.order_id,
      shipment_id = excluded.shipment_id,
      pack_id = excluded.pack_id,
      source = excluded.source,
      label_format = excluded.label_format,
      label_content_type = excluded.label_content_type,
      label_url = excluded.label_url,
      label_payload = excluded.label_payload,
      storage_key = excluded.storage_key,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at`
  ).run({
    id: existing?.id || record.id || randomUUID(),
    connection_id: normalizeNullable(record.connection_id),
    seller_id: sellerId,
    document_key: documentKey,
    order_id: normalizeNullable(record.order_id),
    shipment_id: shipmentId,
    pack_id: normalizeNullable(record.pack_id),
    source: normalizeNullable(record.source) || "unknown",
    label_format: normalizeNullable(record.label_format),
    label_content_type: normalizeNullable(record.label_content_type),
    label_url: normalizeNullable(record.label_url),
    label_payload: JSON.stringify(record.label_payload || {}),
    storage_key: normalizeNullable(record.storage_key),
    fetched_at: normalizeNullable(record.fetched_at) || nowIso(),
    created_at: existing?.created_at || record.created_at || nowIso(),
    updated_at: record.updated_at || nowIso(),
  });

  return getShippingLabelDocument({ sellerId, shipmentId });
}

export function upsertInvoiceDocument(record) {
  const sellerId = normalizeNullable(record.seller_id);
  const documentKey =
    normalizeNullable(record.document_key) ||
    [
      "invoice",
      sellerId || "unknown",
      normalizeNullable(record.invoice_id) || "no-invoice-id",
      normalizeNullable(record.order_id) || "no-order-id",
      normalizeNullable(record.shipment_id) || "no-shipment-id",
      normalizeNullable(record.pack_id) || "no-pack-id",
    ].join(":");

  if (!sellerId || !documentKey) {
    throw new Error("Dados insuficientes para salvar o documento fiscal.");
  }

  const existing = db
    .prepare(
      `SELECT id, created_at FROM ml_invoice_documents
       WHERE document_key = ?
       LIMIT 1`
    )
    .get(documentKey);

  db.prepare(
    `INSERT INTO ml_invoice_documents (
      id,
      connection_id,
      seller_id,
      document_key,
      order_id,
      shipment_id,
      pack_id,
      invoice_id,
      source,
      invoice_number,
      invoice_key,
      invoice_url,
      xml_url,
      invoice_content_type,
      xml_content_type,
      invoice_payload,
      danfe_storage_key,
      xml_storage_key,
      fetched_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @seller_id,
      @document_key,
      @order_id,
      @shipment_id,
      @pack_id,
      @invoice_id,
      @source,
      @invoice_number,
      @invoice_key,
      @invoice_url,
      @xml_url,
      @invoice_content_type,
      @xml_content_type,
      @invoice_payload,
      @danfe_storage_key,
      @xml_storage_key,
      @fetched_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(document_key) DO UPDATE SET
      connection_id = excluded.connection_id,
      order_id = excluded.order_id,
      shipment_id = excluded.shipment_id,
      pack_id = excluded.pack_id,
      invoice_id = excluded.invoice_id,
      source = excluded.source,
      invoice_number = excluded.invoice_number,
      invoice_key = excluded.invoice_key,
      invoice_url = excluded.invoice_url,
      xml_url = excluded.xml_url,
      invoice_content_type = excluded.invoice_content_type,
      xml_content_type = excluded.xml_content_type,
      invoice_payload = excluded.invoice_payload,
      danfe_storage_key = excluded.danfe_storage_key,
      xml_storage_key = excluded.xml_storage_key,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at`
  ).run({
    id: existing?.id || record.id || randomUUID(),
    connection_id: normalizeNullable(record.connection_id),
    seller_id: sellerId,
    document_key: documentKey,
    order_id: normalizeNullable(record.order_id),
    shipment_id: normalizeNullable(record.shipment_id),
    pack_id: normalizeNullable(record.pack_id),
    invoice_id: normalizeNullable(record.invoice_id),
    source: normalizeNullable(record.source) || "unknown",
    invoice_number: normalizeNullable(record.invoice_number),
    invoice_key: normalizeNullable(record.invoice_key),
    invoice_url: normalizeNullable(record.invoice_url),
    xml_url: normalizeNullable(record.xml_url),
    invoice_content_type: normalizeNullable(record.invoice_content_type),
    xml_content_type: normalizeNullable(record.xml_content_type),
    invoice_payload: JSON.stringify(record.invoice_payload || {}),
    danfe_storage_key: normalizeNullable(record.danfe_storage_key),
    xml_storage_key: normalizeNullable(record.xml_storage_key),
    fetched_at: normalizeNullable(record.fetched_at) || nowIso(),
    created_at: existing?.created_at || record.created_at || nowIso(),
    updated_at: record.updated_at || nowIso(),
  });

  return getInvoiceDocument({
    sellerId,
    orderId: record.order_id,
    shipmentId: record.shipment_id,
    packId: record.pack_id,
  });
}
