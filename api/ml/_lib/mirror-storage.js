import { randomUUID } from "node:crypto";
import { db } from "../../_lib/db.js";

const ENTITY_CONFIG = {
  returns: {
    table: "ml_returns",
    label: "Devolucoes",
  },
  claims: {
    table: "ml_claims",
    label: "Reclamacoes",
  },
  packs: {
    table: "ml_packs",
    label: "Packs",
  },
};

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

function getEntityConfig(entity) {
  const config = ENTITY_CONFIG[entity];
  if (!config) {
    throw new Error(`Unsupported seller-center mirror entity: ${entity}`);
  }

  return config;
}

function mapMirrorRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    connection_id: row.connection_id,
    seller_id: row.seller_id,
    external_id: row.external_id,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    pack_id: row.pack_id,
    raw_status: row.raw_status,
    raw_payload: parseJsonSafely(row.raw_payload, {}),
    resource_created_at: row.resource_created_at,
    resource_updated_at: row.resource_updated_at,
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMirrorReferenceRow(row) {
  if (!row) return null;

  return {
    order_id: normalizeNullable(row.order_id),
    shipment_id: normalizeNullable(row.shipment_id),
    pack_id: normalizeNullable(row.pack_id),
  };
}

export function listMirrorEntities(entity, options = {}) {
  const config = getEntityConfig(entity);
  const sellerId = normalizeNullable(options.sellerId);
  const parsedLimit = options.limit == null ? null : Number(options.limit);
  const safeLimit =
    parsedLimit == null
      ? null
      : Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 5000))
        : 200;

  if (sellerId) {
    if (safeLimit == null) {
      return db
        .prepare(
          `SELECT * FROM ${config.table}
           WHERE seller_id = ?
           ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC`
        )
        .all(sellerId)
        .map(mapMirrorRow);
    }

    return db
      .prepare(
        `SELECT * FROM ${config.table}
         WHERE seller_id = ?
         ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC
         LIMIT ?`
      )
      .all(sellerId, safeLimit)
      .map(mapMirrorRow);
  }

  if (safeLimit == null) {
    return db
      .prepare(
        `SELECT * FROM ${config.table}
         ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC`
      )
      .all()
      .map(mapMirrorRow);
  }

  return db
    .prepare(
      `SELECT * FROM ${config.table}
       ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC
       LIMIT ?`
    )
    .all(safeLimit)
    .map(mapMirrorRow);
}

export function listMirrorEntityReferences(entity, options = {}) {
  const config = getEntityConfig(entity);
  const sellerId = normalizeNullable(options.sellerId);
  const parsedLimit = options.limit == null ? null : Number(options.limit);
  const safeLimit =
    parsedLimit == null
      ? null
      : Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(parsedLimit, 5000))
        : 200;

  const baseQuery = sellerId
    ? `SELECT order_id, shipment_id, pack_id
       FROM ${config.table}
       WHERE seller_id = ?
       ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC`
    : `SELECT order_id, shipment_id, pack_id
       FROM ${config.table}
       ORDER BY datetime(COALESCE(resource_updated_at, updated_at)) DESC`;

  const rows =
    sellerId && safeLimit == null
      ? db.prepare(baseQuery).all(sellerId)
      : sellerId
        ? db.prepare(`${baseQuery} LIMIT ?`).all(sellerId, safeLimit)
        : safeLimit == null
          ? db.prepare(baseQuery).all()
          : db.prepare(`${baseQuery} LIMIT ?`).all(safeLimit);

  return rows.map(mapMirrorReferenceRow).filter(Boolean);
}

export function getMirrorEntityByExternalId(entity, options = {}) {
  const config = getEntityConfig(entity);
  const sellerId = normalizeNullable(options.sellerId);
  const externalId = normalizeNullable(options.externalId);

  if (!sellerId || !externalId) {
    return null;
  }

  return mapMirrorRow(
    db
      .prepare(
        `SELECT * FROM ${config.table}
         WHERE seller_id = ?
           AND external_id = ?
         LIMIT 1`
      )
      .get(sellerId, externalId)
  );
}

export function getMirrorEntityStats(entity, options = {}) {
  const config = getEntityConfig(entity);
  const sellerId = normalizeNullable(options.sellerId);

  const query = sellerId
    ? `SELECT
         COUNT(*) AS total,
         MAX(last_synced_at) AS last_synced_at,
         MAX(resource_updated_at) AS last_resource_updated_at
       FROM ${config.table}
       WHERE seller_id = ?`
    : `SELECT
         COUNT(*) AS total,
         MAX(last_synced_at) AS last_synced_at,
         MAX(resource_updated_at) AS last_resource_updated_at
       FROM ${config.table}`;

  const row = sellerId ? db.prepare(query).get(sellerId) : db.prepare(query).get();

  return {
    entity,
    label: config.label,
    count: Number(row?.total || 0),
    last_synced_at: row?.last_synced_at || null,
    last_resource_updated_at: row?.last_resource_updated_at || null,
    implementation_status: row?.last_synced_at ? "synced" : "pending_sync",
  };
}

export function getMirrorEntityStatusBreakdown(entity, options = {}) {
  const config = getEntityConfig(entity);
  const sellerId = normalizeNullable(options.sellerId);
  const parsedLimit = Number(options.limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 20))
    : 8;

  const query = sellerId
    ? `SELECT
         COALESCE(raw_status, 'unknown') AS raw_status,
         COUNT(*) AS total
       FROM ${config.table}
       WHERE seller_id = ?
       GROUP BY COALESCE(raw_status, 'unknown')
       ORDER BY total DESC, raw_status ASC
       LIMIT ?`
    : `SELECT
         COALESCE(raw_status, 'unknown') AS raw_status,
         COUNT(*) AS total
       FROM ${config.table}
       GROUP BY COALESCE(raw_status, 'unknown')
       ORDER BY total DESC, raw_status ASC
       LIMIT ?`;

  const rows = sellerId
    ? db.prepare(query).all(sellerId, safeLimit)
    : db.prepare(query).all(safeLimit);

  return rows.map((row) => ({
    raw_status: row.raw_status || "unknown",
    count: Number(row.total || 0),
  }));
}

export function upsertMirrorEntities(entity, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  const config = getEntityConfig(entity);
  const stmt = db.prepare(
    `INSERT INTO ${config.table} (
      id,
      connection_id,
      seller_id,
      external_id,
      order_id,
      shipment_id,
      pack_id,
      raw_status,
      raw_payload,
      resource_created_at,
      resource_updated_at,
      last_synced_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @seller_id,
      @external_id,
      @order_id,
      @shipment_id,
      @pack_id,
      @raw_status,
      @raw_payload,
      @resource_created_at,
      @resource_updated_at,
      @last_synced_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(seller_id, external_id) DO UPDATE SET
      connection_id = excluded.connection_id,
      order_id = excluded.order_id,
      shipment_id = excluded.shipment_id,
      pack_id = excluded.pack_id,
      raw_status = excluded.raw_status,
      raw_payload = excluded.raw_payload,
      resource_created_at = COALESCE(excluded.resource_created_at, ${config.table}.resource_created_at),
      resource_updated_at = COALESCE(excluded.resource_updated_at, ${config.table}.resource_updated_at),
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at`
  );

  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      const sellerId = normalizeNullable(row.seller_id);
      const externalId = normalizeNullable(row.external_id);
      if (!sellerId || !externalId) {
        continue;
      }

      const existing = db
        .prepare(
          `SELECT id, created_at FROM ${config.table}
           WHERE seller_id = ?
             AND external_id = ?
           LIMIT 1`
        )
        .get(sellerId, externalId);

      stmt.run({
        id: existing?.id || row.id || randomUUID(),
        connection_id: normalizeNullable(row.connection_id),
        seller_id: sellerId,
        external_id: externalId,
        order_id: normalizeNullable(row.order_id),
        shipment_id: normalizeNullable(row.shipment_id),
        pack_id: normalizeNullable(row.pack_id),
        raw_status: normalizeNullable(row.raw_status),
        raw_payload: JSON.stringify(row.raw_payload || {}),
        resource_created_at: normalizeNullable(row.resource_created_at),
        resource_updated_at: normalizeNullable(row.resource_updated_at),
        last_synced_at: normalizeNullable(row.last_synced_at) || nowIso(),
        created_at: existing?.created_at || row.created_at || nowIso(),
        updated_at: row.updated_at || nowIso(),
      });
    }
  });

  transaction(records);
  return records.length;
}

export function getSellerCenterMirrorOverview(sellerId = null) {
  const entities = {
    returns: getMirrorEntityStats("returns", { sellerId }),
    claims: getMirrorEntityStats("claims", { sellerId }),
    packs: getMirrorEntityStats("packs", { sellerId }),
  };
  const hasAnySyncedEntity = Object.values(entities).some(
    (entity) => entity.last_synced_at || entity.count > 0
  );

  return {
    status: "partial",
    incomplete: true,
    note: hasAnySyncedEntity
      ? "Espelhamento Seller Center calibrado como aproximacao publica: os buckets operacionais usam a base interna de pedidos e envios, enquanto devolucoes, reclamacoes e packs seguem auditados em camada separada."
      : "Espelhamento Seller Center ainda parcial: devolucoes, reclamacoes e packs ainda nao foram sincronizados via API oficial.",
    dependencies_pending: ["returns", "claims", "packs"],
    entities,
  };
}
