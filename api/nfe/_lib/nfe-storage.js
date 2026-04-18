import { randomUUID } from "node:crypto";

import { db } from "../../_lib/db.js";
import {
  buildInvoiceStorageKey,
  documentFileExists,
  readDocumentFile,
  writeDocumentFile,
} from "../../ml/_lib/document-storage.js";

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

function mapNfeRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    connection_id: row.connection_id,
    seller_id: row.seller_id,
    order_id: row.order_id,
    ml_order_id: row.ml_order_id,
    shipment_id: row.shipment_id,
    pack_id: row.pack_id,
    issuer_user_id: row.issuer_user_id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    invoice_series: row.invoice_series,
    invoice_key: row.invoice_key,
    authorization_protocol: row.authorization_protocol,
    status: row.status,
    transaction_status: row.transaction_status,
    environment: row.environment,
    source: row.source,
    ml_sync_status: row.ml_sync_status,
    issued_at: row.issued_at,
    authorized_at: row.authorized_at,
    xml_payload: row.xml_payload,
    danfe_storage_key: row.danfe_storage_key,
    xml_storage_key: row.xml_storage_key,
    raw_payload: parseJsonSafely(row.raw_payload, {}),
    error_code: row.error_code,
    error_message: row.error_message,
    last_sync_at: row.last_sync_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function buildNfeDanfeStorageKey(sellerId, invoiceId) {
  return buildInvoiceStorageKey(sellerId, `nfe-${invoiceId}-danfe`, "pdf");
}

export function buildNfeXmlStorageKey(sellerId, invoiceId) {
  return buildInvoiceStorageKey(sellerId, `nfe-${invoiceId}-xml`, "xml");
}

export function getNfeDocumentByOrderId(sellerId, orderId) {
  const normalizedSellerId = normalizeNullable(sellerId);
  const normalizedOrderId = normalizeNullable(orderId);
  if (!normalizedSellerId || !normalizedOrderId) return null;

  return mapNfeRow(
    db
      .prepare(
        `SELECT * FROM nfe_documents
         WHERE seller_id = ?
           AND order_id = ?
         ORDER BY datetime(updated_at) DESC
         LIMIT 1`
      )
      .get(normalizedSellerId, normalizedOrderId)
  );
}

export function listNfeDocuments(limit = 100) {
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(Number(limit), 1000))
    : 100;

  return db
    .prepare(
      `SELECT * FROM nfe_documents
       ORDER BY datetime(updated_at) DESC
       LIMIT ?`
    )
    .all(safeLimit)
    .map(mapNfeRow);
}

export function listNfeDocumentsBySellerId(sellerId, limit = 200) {
  const normalizedSellerId = normalizeNullable(sellerId);
  if (!normalizedSellerId) {
    return [];
  }

  const safeLimit =
    limit == null
      ? null
      : Number.isFinite(Number(limit))
        ? Math.max(1, Math.min(Number(limit), 5000))
        : 200;

  if (safeLimit == null) {
    return db
      .prepare(
        `SELECT * FROM nfe_documents
         WHERE seller_id = ?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(normalizedSellerId)
      .map(mapNfeRow);
  }

  return db
    .prepare(
      `SELECT * FROM nfe_documents
       WHERE seller_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT ?`
    )
    .all(normalizedSellerId, safeLimit)
    .map(mapNfeRow);
}

export function upsertNfeDocument(record) {
  const sellerId = normalizeNullable(record.seller_id);
  const orderId = normalizeNullable(record.order_id);
  const mlOrderId = normalizeNullable(record.ml_order_id) || orderId;

  if (!sellerId || !orderId || !mlOrderId) {
    throw new Error("Dados insuficientes para salvar a NF-e.");
  }

  const existing = db
    .prepare(
      `SELECT id, created_at
       FROM nfe_documents
       WHERE seller_id = ?
         AND order_id = ?
       LIMIT 1`
    )
    .get(sellerId, orderId);

  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO nfe_documents (
      id,
      connection_id,
      seller_id,
      order_id,
      ml_order_id,
      shipment_id,
      pack_id,
      issuer_user_id,
      invoice_id,
      invoice_number,
      invoice_series,
      invoice_key,
      authorization_protocol,
      status,
      transaction_status,
      environment,
      source,
      ml_sync_status,
      issued_at,
      authorized_at,
      xml_payload,
      danfe_storage_key,
      xml_storage_key,
      raw_payload,
      error_code,
      error_message,
      last_sync_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @seller_id,
      @order_id,
      @ml_order_id,
      @shipment_id,
      @pack_id,
      @issuer_user_id,
      @invoice_id,
      @invoice_number,
      @invoice_series,
      @invoice_key,
      @authorization_protocol,
      @status,
      @transaction_status,
      @environment,
      @source,
      @ml_sync_status,
      @issued_at,
      @authorized_at,
      @xml_payload,
      @danfe_storage_key,
      @xml_storage_key,
      @raw_payload,
      @error_code,
      @error_message,
      @last_sync_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(seller_id, order_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      ml_order_id = excluded.ml_order_id,
      shipment_id = excluded.shipment_id,
      pack_id = excluded.pack_id,
      issuer_user_id = excluded.issuer_user_id,
      invoice_id = excluded.invoice_id,
      invoice_number = excluded.invoice_number,
      invoice_series = excluded.invoice_series,
      invoice_key = excluded.invoice_key,
      authorization_protocol = excluded.authorization_protocol,
      status = excluded.status,
      transaction_status = excluded.transaction_status,
      environment = excluded.environment,
      source = excluded.source,
      ml_sync_status = excluded.ml_sync_status,
      issued_at = excluded.issued_at,
      authorized_at = excluded.authorized_at,
      xml_payload = excluded.xml_payload,
      danfe_storage_key = excluded.danfe_storage_key,
      xml_storage_key = excluded.xml_storage_key,
      raw_payload = excluded.raw_payload,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      last_sync_at = excluded.last_sync_at,
      updated_at = excluded.updated_at`
  ).run({
    id: existing?.id || record.id || randomUUID(),
    connection_id: normalizeNullable(record.connection_id),
    seller_id: sellerId,
    order_id: orderId,
    ml_order_id: mlOrderId,
    shipment_id: normalizeNullable(record.shipment_id),
    pack_id: normalizeNullable(record.pack_id),
    issuer_user_id: normalizeNullable(record.issuer_user_id),
    invoice_id: normalizeNullable(record.invoice_id),
    invoice_number: normalizeNullable(record.invoice_number),
    invoice_series: normalizeNullable(record.invoice_series),
    invoice_key: normalizeNullable(record.invoice_key),
    authorization_protocol: normalizeNullable(record.authorization_protocol),
    status: normalizeNullable(record.status) || "pending",
    transaction_status: normalizeNullable(record.transaction_status),
    environment: normalizeNullable(record.environment),
    source: normalizeNullable(record.source) || "mercado_livre_faturador",
    ml_sync_status: normalizeNullable(record.ml_sync_status),
    issued_at: normalizeNullable(record.issued_at),
    authorized_at: normalizeNullable(record.authorized_at),
    xml_payload: typeof record.xml_payload === "string" ? record.xml_payload : null,
    danfe_storage_key: normalizeNullable(record.danfe_storage_key),
    xml_storage_key: normalizeNullable(record.xml_storage_key),
    raw_payload: JSON.stringify(record.raw_payload || {}),
    error_code: normalizeNullable(record.error_code),
    error_message: normalizeNullable(record.error_message),
    last_sync_at: normalizeNullable(record.last_sync_at),
    created_at: existing?.created_at || record.created_at || timestamp,
    updated_at: timestamp,
  });

  return getNfeDocumentByOrderId(sellerId, orderId);
}

/**
 * Tenta adquirir lock para emitir NF-e de um pedido. Evita race condition
 * entre generateNfe() (HTTP manual) e runAutoEmitNfe() (cron) emitindo
 * duas NF-es para o mesmo pedido.
 *
 * Estratégia: INSERT de registro com status "emitting". Se já existir
 * (UNIQUE constraint em seller_id + order_id), retorna false. Se o registro
 * existente tem status terminal (authorized, error, cancelled), também
 * retorna false — emissão já concluída ou já falhou definitivamente.
 *
 * Retorna:
 *   { acquired: true, existing: null } → OK pra prosseguir com emissão
 *   { acquired: false, existing: {...} } → outro processo já emitindo
 *                                            OU já existe NF-e autorizada
 */
export function acquireNfeEmissionLock({ sellerId, orderId, connectionId, mlOrderId }) {
  const sid = normalizeNullable(sellerId);
  const oid = normalizeNullable(orderId);
  const mlOid = normalizeNullable(mlOrderId) || oid;
  if (!sid || !oid || !mlOid) {
    throw new Error("sellerId/orderId obrigatórios pra lock de NF-e.");
  }

  // Verifica se já existe registro
  const existing = getNfeDocumentByOrderId(sid, oid);

  if (existing) {
    const existingStatus = String(existing.status || "").toLowerCase();
    // Estados em que NÃO pode disparar nova emissão:
    //   - authorized: já emitida com sucesso
    //   - emitting: outro processo está no meio da emissão
    //   - pending_configuration: emitida mas aguardando ML
    if (
      existingStatus === "authorized" ||
      existingStatus === "emitting" ||
      existingStatus === "pending_configuration"
    ) {
      return { acquired: false, existing };
    }
    // Estados recuperáveis (error, cancelled): permite nova tentativa,
    // mas faz UPDATE do status pra "emitting" antes.
    try {
      const timestamp = nowIso();
      db.prepare(
        `UPDATE nfe_documents
         SET status = 'emitting',
             updated_at = ?,
             error_code = NULL,
             error_message = NULL
         WHERE seller_id = ? AND order_id = ? AND status IN ('error', 'cancelled')`
      ).run(timestamp, sid, oid);
      return { acquired: true, existing };
    } catch {
      return { acquired: false, existing };
    }
  }

  // Não existe: INSERT novo com status "emitting"
  try {
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO nfe_documents (
        id,
        connection_id,
        seller_id,
        order_id,
        ml_order_id,
        status,
        source,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'emitting', 'lock', ?, ?)`
    ).run(
      randomUUID(),
      connectionId || null,
      sid,
      oid,
      mlOid,
      timestamp,
      timestamp
    );
    return { acquired: true, existing: null };
  } catch (err) {
    // UNIQUE constraint: outro processo inseriu no mesmo instante
    return { acquired: false, existing: getNfeDocumentByOrderId(sid, oid) };
  }
}

/**
 * Libera o lock se o processo falhar antes de gravar resultado final.
 * Remove registro com status="emitting" que foi criado por acquireLock.
 * NÃO remove registros com resultado (authorized, error, pending_configuration).
 */
export function releaseNfeEmissionLock(sellerId, orderId) {
  const sid = normalizeNullable(sellerId);
  const oid = normalizeNullable(orderId);
  if (!sid || !oid) return;
  try {
    db.prepare(
      `DELETE FROM nfe_documents
       WHERE seller_id = ?
         AND order_id = ?
         AND status = 'emitting'
         AND source = 'lock'`
    ).run(sid, oid);
  } catch {
    // best-effort
  }
}

export function saveNfeDanfeFile(sellerId, invoiceId, buffer) {
  const storageKey = buildNfeDanfeStorageKey(sellerId, invoiceId);
  writeDocumentFile(storageKey, buffer);
  return storageKey;
}

export function saveNfeXmlFile(sellerId, invoiceId, buffer) {
  const storageKey = buildNfeXmlStorageKey(sellerId, invoiceId);
  writeDocumentFile(storageKey, buffer);
  return storageKey;
}

export function hasNfeDanfeFile(record) {
  return Boolean(record?.danfe_storage_key && documentFileExists(record.danfe_storage_key));
}

export function hasNfeXmlFile(record) {
  return Boolean(record?.xml_storage_key && documentFileExists(record.xml_storage_key));
}

export function readNfeDanfeFile(record) {
  if (!record?.danfe_storage_key) return null;
  return readDocumentFile(record.danfe_storage_key);
}

export function readNfeXmlFile(record) {
  if (!record?.xml_storage_key) return null;
  return readDocumentFile(record.xml_storage_key);
}
