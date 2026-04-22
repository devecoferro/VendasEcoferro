import { randomUUID, createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

// ─── Token Encryption ──────────────────────────────────────────────
// Criptografa access_token e refresh_token antes de salvar no SQLite.
// Usa AES-256-GCM com chave derivada de ML_CLIENT_SECRET (env var).
// Se ML_CLIENT_SECRET não estiver configurado, tokens são salvos em texto
// puro para compatibilidade com ambientes de desenvolvimento.
const TOKEN_ENCRYPTION_ALGO = "aes-256-gcm";

function getEncryptionKey() {
  const secret = process.env.ML_CLIENT_SECRET;
  if (!secret) return null;
  // Deriva chave de 32 bytes a partir do client_secret
  return createHash("sha256").update(secret).digest();
}

function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  if (!key) return plaintext; // Sem chave = sem criptografia (dev mode)

  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Formato: "enc:iv_hex:tag_hex:ciphertext_hex"
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptToken(stored) {
  if (!stored) return null;
  if (!stored.startsWith("enc:")) return stored; // Token antigo em texto puro

  const key = getEncryptionKey();
  if (!key) return stored; // Sem chave = retorna como está

  try {
    const [, ivHex, tagHex, ciphertextHex] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const decipher = createDecipheriv(TOKEN_ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    // Se falhar a descriptografia, retorna o valor original
    // (pode ser um token antigo não criptografado)
    return stored;
  }
}

const OPERATIONAL_ORDER_STATUSES = [
  "confirmed",
  "paid",
  "pending",
  "handling",
  "ready_to_ship",
  "shipped",
  "in_transit",
  "delivered",
  "cancelled",
  "not_delivered",
  "returned",
];

const MAX_PAGINATION_LIMIT = 1000;

// Piso de visibilidade: vendas com sale_date anterior a esta data nao
// sao retornadas por nenhuma query de listagem, mesmo que ainda existam
// no banco. Alinhado com MIN_SYNC_DATE_FROM em api/ml/sync.js.
const MIN_VISIBLE_SALE_DATE = "2026-04-01";

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

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function mapConnection(row) {
  if (!row) return null;

  return {
    id: row.id,
    seller_id: row.seller_id,
    seller_nickname: row.seller_nickname,
    access_token: decryptToken(row.access_token),
    refresh_token: decryptToken(row.refresh_token),
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
    // Timestamp ISO-8601 UTC da ultima vez que a etiqueta deste pedido
    // foi impressa (null = nunca impressa). Usado pelos filtros
    // "Com etiqueta" / "Sem etiqueta" da MercadoLivrePage.
    label_printed_at: row.label_printed_at || null,
    // Data de coleta agendada pelo ML (lead_time.estimated_schedule_limit).
    // null = sem coleta agendada. Usado pelo ColetasPanel pra agrupar
    // orders por data real sem depender de regex no scraping.
    pickup_scheduled_date: row.pickup_scheduled_date || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildSummaryOrderTitle(itemTitle, groupedItemsCount) {
  if (!itemTitle) {
    return null;
  }

  if (groupedItemsCount <= 1) {
    return itemTitle;
  }

  return `${itemTitle} + ${groupedItemsCount - 1} item(ns)`;
}

function mapSummaryOrder(row) {
  const mappedOrder = mapOrder(row);
  const groupedItemsCount = Number(row?.grouped_items_count || 1);
  const groupedQuantityTotal = Number(row?.grouped_quantity_total || mappedOrder.quantity || 0);
  const rawGroupedAmount = Number(row?.grouped_amount_total);
  const groupedAmountTotal = Number.isFinite(rawGroupedAmount)
    ? rawGroupedAmount
    : mappedOrder.amount;

  return {
    ...mappedOrder,
    item_title: buildSummaryOrderTitle(mappedOrder.item_title, groupedItemsCount),
    quantity: groupedQuantityTotal,
    amount:
      groupedAmountTotal == null || Number.isNaN(Number(groupedAmountTotal))
        ? null
        : Number(groupedAmountTotal),
    raw_data:
      mappedOrder.raw_data && typeof mappedOrder.raw_data === "object"
        ? {
            ...mappedOrder.raw_data,
            grouped_items_count: groupedItemsCount,
            grouped_quantity_total: groupedQuantityTotal,
          }
        : mappedOrder.raw_data,
  };
}

function mapOrderReferenceSummary(row) {
  if (!row) {
    return null;
  }

  return {
    order_id: normalizeNullable(row.order_id),
    shipment_id: normalizeNullable(row.shipment_id),
    pack_id: normalizeNullable(row.pack_id),
    deposit_key: normalizeNullable(row.deposit_key) || "without-deposit",
    deposit_label: normalizeNullable(row.deposit_label) || "Vendas sem deposito",
    logistic_type:
      normalizeNullable(row.logistic_type)?.toLowerCase() || "unknown",
  };
}

function buildOrderReferenceSummariesQuery(scope = "all") {
  const { whereSql, params } = getScopeFilter(scope);

  return {
    sql: `
      WITH filtered_orders AS (
        SELECT
          order_id,
          shipping_id,
          json_extract(raw_data, '$.shipping_id') AS raw_shipping_id,
          json_extract(raw_data, '$.shipment_snapshot.id') AS snapshot_shipping_id,
          json_extract(raw_data, '$.pack_id') AS pack_id,
          json_extract(raw_data, '$.deposit_snapshot.key') AS deposit_key,
          json_extract(raw_data, '$.deposit_snapshot.label') AS deposit_label,
          lower(
            COALESCE(
              json_extract(raw_data, '$.deposit_snapshot.logistic_type'),
              json_extract(raw_data, '$.shipment_snapshot.logistic_type'),
              'unknown'
            )
          ) AS logistic_type,
          ROW_NUMBER() OVER (
            PARTITION BY order_id
            ORDER BY COALESCE(sale_date, '') DESC, id ASC
          ) AS row_number,
          MAX(COALESCE(sale_date, '')) OVER (PARTITION BY order_id) AS sort_sale_date
        FROM ml_orders
        ${whereSql}
      )
      SELECT
        order_id,
        COALESCE(shipping_id, raw_shipping_id, snapshot_shipping_id) AS shipment_id,
        pack_id,
        COALESCE(deposit_key, 'without-deposit') AS deposit_key,
        COALESCE(deposit_label, 'Vendas sem deposito') AS deposit_label,
        COALESCE(logistic_type, 'unknown') AS logistic_type
      FROM filtered_orders
      WHERE row_number = 1
      ORDER BY sort_sale_date DESC, order_id DESC
    `,
    params,
  };
}

export function getLatestConnection() {
  const row = db
    .prepare(`SELECT * FROM ml_connections ORDER BY datetime(created_at) DESC LIMIT 1`)
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

export function listConnections() {
  return db
    .prepare(`SELECT * FROM ml_connections ORDER BY datetime(created_at) DESC`)
    .all()
    .map(mapConnection);
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
    access_token: encryptToken(connection.access_token),
    refresh_token: encryptToken(connection.refresh_token) || null,
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
    access_token: encryptToken(tokenData.access_token),
    refresh_token: encryptToken(tokenData.refresh_token) || null,
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
  const transaction = db.transaction((id) => {
    db.prepare(`DELETE FROM ml_orders WHERE connection_id = ?`).run(id);
    db.prepare(`DELETE FROM ml_connections WHERE id = ?`).run(id);
  });

  transaction(connectionId);
}

export function deleteAllConnectionsAndOrders() {
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM ml_orders`).run();
    db.prepare(`DELETE FROM ml_connections`).run();
  });

  transaction();
}

export function getOrders(limit = null) {
  if (limit == null) {
    return db
      .prepare(
        `SELECT * FROM ml_orders
         WHERE COALESCE(sale_date, '') >= ?
         ORDER BY datetime(sale_date) DESC`
      )
      .all(MIN_VISIBLE_SALE_DATE)
      .map(mapOrder);
  }

  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(Number(limit), 50000))
    : 500;

  return db
    .prepare(
      `SELECT * FROM ml_orders
       WHERE COALESCE(sale_date, '') >= ?
       ORDER BY datetime(sale_date) DESC
       LIMIT ?`
    )
    .all(MIN_VISIBLE_SALE_DATE, safeLimit)
    .map(mapOrder);
}

function getScopeFilter(scope = "all") {
  // Piso de data aplicado a todas as consultas — vendas anteriores a
  // MIN_VISIBLE_SALE_DATE ficam invisiveis no front, mesmo que ainda
  // existam no banco.
  const dateFloorClause = `COALESCE(sale_date, '') >= ?`;
  const dateFloorParam = MIN_VISIBLE_SALE_DATE;

  if (String(scope || "").trim().toLowerCase() !== "operational") {
    return {
      whereSql: `WHERE ${dateFloorClause}`,
      params: [dateFloorParam],
    };
  }

  const placeholders = OPERATIONAL_ORDER_STATUSES.map(() => "?").join(", ");

  return {
    whereSql: `WHERE ${dateFloorClause} AND lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) IN (${placeholders})`,
    params: [dateFloorParam, ...OPERATIONAL_ORDER_STATUSES],
  };
}

function sanitizePaginationLimit(limit, fallback = 300) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(numericLimit), MAX_PAGINATION_LIMIT));
}

function sanitizePaginationOffset(offset) {
  const numericOffset = Number(offset);
  if (!Number.isFinite(numericOffset)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numericOffset));
}

export function countOrdersByScope(scope = "all") {
  const { whereSql, params } = getScopeFilter(scope);
  const row = db
    .prepare(
      `
        SELECT COUNT(DISTINCT order_id) AS total
        FROM ml_orders
        ${whereSql}
      `
    )
    .get(...params);

  return Number(row?.total || 0);
}

function buildOrderSummariesQuery({
  scope = "all",
  limit = null,
  offset = 0,
} = {}) {
  const { whereSql, params } = getScopeFilter(scope);
  const hasPagination = limit != null;
  const safeLimit = hasPagination ? sanitizePaginationLimit(limit) : null;
  const safeOffset = hasPagination ? sanitizePaginationOffset(offset) : 0;

  const sql = `
    WITH filtered_orders AS (
      SELECT
        ml_orders.*,
        ROW_NUMBER() OVER (
          PARTITION BY order_id
          ORDER BY COALESCE(sale_date, '') DESC, id ASC
        ) AS row_number,
        COUNT(*) OVER (PARTITION BY order_id) AS grouped_items_count,
        SUM(COALESCE(quantity, 0)) OVER (PARTITION BY order_id) AS grouped_quantity_total,
        SUM(COALESCE(amount, 0)) OVER (PARTITION BY order_id) AS grouped_amount_total,
        MAX(COALESCE(sale_date, '')) OVER (PARTITION BY order_id) AS sort_sale_date
      FROM ml_orders
      ${whereSql}
    )
    SELECT *
    FROM filtered_orders
    WHERE row_number = 1
    ORDER BY sort_sale_date DESC, order_id DESC
    ${hasPagination ? "LIMIT ? OFFSET ?" : ""}
  `;

  return {
    sql,
    params: hasPagination ? [...params, safeLimit, safeOffset] : params,
  };
}

export function getOrderSummariesByScope(scope = "all") {
  const { sql, params } = buildOrderSummariesQuery({ scope });
  return db.prepare(sql).all(...params).map(mapSummaryOrder);
}

export function getOrderReferenceSummaries(scope = "all") {
  const { sql, params } = buildOrderReferenceSummariesQuery(scope);
  return db.prepare(sql).all(...params).map(mapOrderReferenceSummary).filter(Boolean);
}

export function getPaginatedOrderSummaries({
  scope = "all",
  limit = 300,
  offset = 0,
} = {}) {
  const { sql, params } = buildOrderSummariesQuery({
    scope,
    limit,
    offset,
  });

  return db.prepare(sql).all(...params).map(mapSummaryOrder);
}

export function getPaginatedOrderRows({
  scope = "all",
  limit = 300,
  offset = 0,
} = {}) {
  const { whereSql, params } = getScopeFilter(scope);
  const safeLimit = sanitizePaginationLimit(limit);
  const safeOffset = sanitizePaginationOffset(offset);

  return db
    .prepare(
      `
        WITH paginated_orders AS (
          SELECT
            order_id,
            MAX(COALESCE(sale_date, '')) AS sort_sale_date
          FROM ml_orders
          ${whereSql}
          GROUP BY order_id
          ORDER BY sort_sale_date DESC, order_id DESC
          LIMIT ? OFFSET ?
        )
        SELECT ml_orders.*
        FROM ml_orders
        INNER JOIN paginated_orders
          ON paginated_orders.order_id = ml_orders.order_id
        ORDER BY
          paginated_orders.sort_sale_date DESC,
          paginated_orders.order_id DESC,
          COALESCE(ml_orders.sale_date, '') DESC,
          ml_orders.id ASC
      `
    )
    .all(...params, safeLimit, safeOffset)
    .map(mapOrder);
}

export function getOperationalOrders(limit = null) {
  const placeholders = OPERATIONAL_ORDER_STATUSES.map(() => "?").join(", ");
  const statusParams = [...OPERATIONAL_ORDER_STATUSES];

  if (limit == null) {
    return db
      .prepare(
        `SELECT * FROM ml_orders
         WHERE COALESCE(sale_date, '') >= ?
           AND lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) IN (${placeholders})
         ORDER BY datetime(sale_date) DESC`
      )
      .all(MIN_VISIBLE_SALE_DATE, ...statusParams)
      .map(mapOrder);
  }

  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(Number(limit), 50000))
    : 500;

  return db
    .prepare(
      `SELECT * FROM ml_orders
       WHERE COALESCE(sale_date, '') >= ?
         AND lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) IN (${placeholders})
       ORDER BY datetime(sale_date) DESC
       LIMIT ?`
    )
    .all(MIN_VISIBLE_SALE_DATE, ...statusParams, safeLimit)
    .map(mapOrder);
}

export function getOrderRowsByOrderId(orderId) {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    return [];
  }

  return db
    .prepare(
      `SELECT * FROM ml_orders
       WHERE order_id = ?
       ORDER BY datetime(sale_date) DESC, id ASC`
    )
    .all(normalizedOrderId)
    .map(mapOrder);
}

export function getOrderRowsByPackId(packId) {
  const normalizedPackId = String(packId || "").trim();
  if (!normalizedPackId) {
    return [];
  }

  return db
    .prepare(
      `SELECT * FROM ml_orders
       WHERE json_extract(raw_data, '$.pack_id') = ?
       ORDER BY datetime(sale_date) DESC, id ASC`
    )
    .all(normalizedPackId)
    .map(mapOrder);
}

/**
 * Apaga do banco todas as vendas com sale_date anterior ao piso
 * (MIN_VISIBLE_SALE_DATE). NULL fica preservado pra nao remover
 * registros que ainda nao tiveram sale_date preenchido. Idempotente —
 * seguro chamar no boot. Retorna a quantidade de linhas removidas.
 */
export function purgeOrdersBeforeFloor() {
  const stmt = db.prepare(
    `DELETE FROM ml_orders
     WHERE sale_date IS NOT NULL
       AND sale_date < ?`
  );
  const result = stmt.run(MIN_VISIBLE_SALE_DATE);
  return Number(result.changes || 0);
}

export function deleteOrdersByOrderIds(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return 0;
  }

  const uniqueOrderIds = [
    ...new Set(orderIds.map((value) => String(value).trim()).filter(Boolean)),
  ];
  if (uniqueOrderIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueOrderIds.map(() => "?").join(", ");
  const stmt = db.prepare(`DELETE FROM ml_orders WHERE order_id IN (${placeholders})`);
  const result = stmt.run(...uniqueOrderIds);
  return Number(result.changes || 0);
}

export function replaceOrdersByOrderIds(orderIdsToDelete, newRecords) {
  const transaction = db.transaction(() => {
    deleteOrdersByOrderIds(orderIdsToDelete);
    upsertOrders(newRecords);
  });
  transaction();
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
        pickup_scheduled_date,
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
        @pickup_scheduled_date,
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
        pickup_scheduled_date = excluded.pickup_scheduled_date,
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
        pickup_scheduled_date: row.pickup_scheduled_date ?? null,
        raw_data: JSON.stringify(row.raw_data || {}),
        created_at: existing?.created_at || row.created_at || nowIso(),
        updated_at: row.updated_at || nowIso(),
      });
    }
  });

  transaction(records);
  return records.length;
}

/**
 * Marca (ou desmarca) um conjunto de pedidos como "etiqueta impressa".
 *
 * Usa `order_id` (ID externo do ML, nao o PK composto) porque a UI trabalha
 * com order_id — um pedido multi-item tem varias linhas na ml_orders com
 * o mesmo order_id, e todas devem ficar marcadas em bloco para o filtro
 * da MercadoLivrePage funcionar corretamente.
 *
 * @param {string[]} orderIds lista de order_ids a marcar
 * @param {string|null} printedAt ISO-8601 ou null (para desmarcar)
 * @returns {number} quantidade de linhas afetadas
 */
export function setOrdersLabelPrinted(orderIds, printedAt) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return 0;
  }

  const uniqueOrderIds = [
    ...new Set(
      orderIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    ),
  ];

  if (uniqueOrderIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueOrderIds.map(() => "?").join(", ");
  const stmt = db.prepare(
    `UPDATE ml_orders
     SET label_printed_at = ?,
         updated_at = ?
     WHERE order_id IN (${placeholders})`
  );

  const result = stmt.run(
    printedAt || null,
    nowIso(),
    ...uniqueOrderIds
  );
  return Number(result.changes || 0);
}
