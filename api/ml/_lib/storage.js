import { randomUUID } from "node:crypto";
import { db } from "./db.js";

function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafely(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapConnection(row) {
  if (!row) return null;

  return {
    id: row.id,
    seller_id: row.seller_id,
    seller_nickname: row.seller_nickname,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    token_expires_at: row.token_expires_at,
    last_sync_at: row.last_sync_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    connection_id: row.connection_id,
    order_id: row.order_id,
    sale_number: row.sale_number,
    sale_date: row.sale_date,
    buyer_name: row.buyer_name,
    buyer_nickname: row.buyer_nickname,
    item_title: row.item_title,
    item_id: row.item_id,
    product_image_url: row.product_image_url,
    sku: row.sku,
    quantity: Number(row.quantity || 0),
    amount:
      row.amount == null || Number.isNaN(Number(row.amount))
        ? null
        : Number(row.amount),
    order_status: row.order_status,
    shipping_id: row.shipping_id,
    raw_data: parseJsonSafely(row.raw_data, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getLatestConnection() {
  const row = db
    .prepare(
      `SELECT * FROM ml_connections ORDER BY datetime(created_at) DESC LIMIT 1`
    )
    .get();

  return mapConnection(row);
}

export function getConnectionById(connectionId) {
  const row = db
    .prepare(`SELECT * FROM ml_connections WHERE id = ? LIMIT 1`)
    .get(connectionId);

  return mapConnection(row);
}

export function getConnectionBySellerId(sellerId) {
  const row = db
    .prepare(`SELECT * FROM ml_connections WHERE seller_id = ? LIMIT 1`)
    .get(String(sellerId));

  return mapConnection(row);
}

export function upsertConnection(connection) {
  const existing = getConnectionBySellerId(connection.seller_id);
  const id = existing?.id || connection.id || randomUUID();
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();

  db.prepare(
    `
      INSERT INTO ml_connections (
        id,
        seller_id,
        seller_nickname,
        access_token,
        refresh_token,
        token_expires_at,
        last_sync_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @seller_id,
        @seller_nickname,
        @access_token,
        @refresh_token,
        @token_expires_at,
        @last_sync_at,
        @created_at,
        @updated_at
      )
      ON CONFLICT(seller_id) DO UPDATE SET
        seller_nickname = excluded.seller_nickname,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        last_sync_at = COALESCE(excluded.last_sync_at, ml_connections.last_sync_at),
        updated_at = excluded.updated_at
    `
  ).run({
    id,
    seller_id: String(connection.seller_id),
    seller_nickname: connection.seller_nickname || null,
    access_token: connection.access_token,
    refresh_token: connection.refresh_token || null,
    token_expires_at: connection.token_expires_at || null,
    last_sync_at: connection.last_sync_at || existing?.last_sync_at || null,
    created_at: createdAt,
    updated_at: updatedAt,
  });

  return getConnectionById(id);
}

export function updateConnectionTokens(connectionId, tokenData) {
  db.prepare(
    `
      UPDATE ml_connections
      SET
        access_token = @access_token,
        refresh_token = @refresh_token,
        token_expires_at = @token_expires_at,
        updated_at = @updated_at
      WHERE id = @id
    `
  ).run({
    id: connectionId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    token_expires_at: tokenData.token_expires_at || null,
    updated_at: nowIso(),
  });

  return getConnectionById(connectionId);
}

export function updateConnectionLastSync(connectionId, lastSyncAt = nowIso()) {
  db.prepare(
    `
      UPDATE ml_connections
      SET
        last_sync_at = @last_sync_at,
        updated_at = @updated_at
      WHERE id = @id
    `
  ).run({
    id: connectionId,
    last_sync_at: lastSyncAt,
    updated_at: nowIso(),
  });

  return getConnectionById(connectionId);
}

export function deleteConnection(connectionId) {
  const deleteOrders = db.prepare(`DELETE FROM ml_orders WHERE connection_id = ?`);
  const deleteConnectionStmt = db.prepare(`DELETE FROM ml_connections WHERE id = ?`);

  const transaction = db.transaction((id) => {
    deleteOrders.run(id);
    deleteConnectionStmt.run(id);
  });

  transaction(connectionId);
}

export function getOrders(limit = 500) {
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(Number(limit), 5000))
    : 500;

  return db
    .prepare(`SELECT * FROM ml_orders ORDER BY datetime(sale_date) DESC LIMIT ?`)
    .all(safeLimit)
    .map(mapOrder);
}

export function deleteOrdersByOrderIds(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return 0;
  }

  const uniqueOrderIds = [...new Set(orderIds.map((value) => String(value).trim()).filter(Boolean))];
  if (uniqueOrderIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueOrderIds.map(() => "?").join(", ");
  const stmt = db.prepare(`DELETE FROM ml_orders WHERE order_id IN (${placeholders})`);
  const result = stmt.run(...uniqueOrderIds);
  return Number(result.changes || 0);
}

export function upsertOrders(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  const stmt = db.prepare(
    `
      INSERT INTO ml_orders (
        id,
        connection_id,
        order_id,
        sale_number,
        sale_date,
        buyer_name,
        buyer_nickname,
        item_title,
        item_id,
        product_image_url,
        sku,
        quantity,
        amount,
        order_status,
        shipping_id,
        raw_data,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @connection_id,
        @order_id,
        @sale_number,
        @sale_date,
        @buyer_name,
        @buyer_nickname,
        @item_title,
        @item_id,
        @product_image_url,
        @sku,
        @quantity,
        @amount,
        @order_status,
        @shipping_id,
        @raw_data,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        connection_id = excluded.connection_id,
        order_id = excluded.order_id,
        sale_number = excluded.sale_number,
        sale_date = excluded.sale_date,
        buyer_name = excluded.buyer_name,
        buyer_nickname = excluded.buyer_nickname,
        item_title = excluded.item_title,
        item_id = excluded.item_id,
        product_image_url = excluded.product_image_url,
        sku = excluded.sku,
        quantity = excluded.quantity,
        amount = excluded.amount,
        order_status = excluded.order_status,
        shipping_id = excluded.shipping_id,
        raw_data = excluded.raw_data,
        updated_at = excluded.updated_at
    `
  );

  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      const existing = db
        .prepare(`SELECT created_at FROM ml_orders WHERE id = ? LIMIT 1`)
        .get(row.id);

      stmt.run({
        ...row,
        quantity: Number(row.quantity || 0),
        amount:
          row.amount == null || Number.isNaN(Number(row.amount))
            ? null
            : Number(row.amount),
        raw_data: JSON.stringify(row.raw_data || {}),
        created_at: existing?.created_at || nowIso(),
        updated_at: nowIso(),
      });
    }
  });

  transaction(records);
  return records.length;
}
