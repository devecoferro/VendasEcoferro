import { randomUUID } from "node:crypto";
import { db } from "../_lib/db.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getConnectionById } from "./_lib/storage.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

const STOCK_PAGE_LIMIT = 100;
const STOCK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let stockCacheTimestamp = 0;

function nowIso() {
  return new Date().toISOString();
}

function upsertStockItems(items) {
  const stmt = db.prepare(`
    INSERT INTO ml_stock (
      id, connection_id, seller_id, item_id, sku, title,
      available_quantity, sold_quantity, total_quantity,
      status, condition, listing_type, price, thumbnail,
      brand, model, vehicle_year,
      synced_at, created_at, updated_at
    ) VALUES (
      @id, @connection_id, @seller_id, @item_id, @sku, @title,
      @available_quantity, @sold_quantity, @total_quantity,
      @status, @condition, @listing_type, @price, @thumbnail,
      @brand, @model, @vehicle_year,
      @synced_at, @created_at, @updated_at
    )
    ON CONFLICT(connection_id, item_id) DO UPDATE SET
      sku = excluded.sku,
      title = excluded.title,
      available_quantity = excluded.available_quantity,
      sold_quantity = excluded.sold_quantity,
      total_quantity = excluded.total_quantity,
      status = excluded.status,
      condition = excluded.condition,
      listing_type = excluded.listing_type,
      price = excluded.price,
      thumbnail = excluded.thumbnail,
      brand = excluded.brand,
      model = excluded.model,
      vehicle_year = excluded.vehicle_year,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });

  insertMany(items);
}

async function fetchItemsPage(accessToken, sellerId, offset) {
  const params = new URLSearchParams({
    seller_id: String(sellerId),
    limit: String(STOCK_PAGE_LIMIT),
    offset: String(offset),
  });

  const response = await fetch(
    `https://api.mercadolibre.com/users/${sellerId}/items/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar itens do Mercado Livre: ${text}`);
  }

  return response.json();
}

// IDs de atributos do ML para marca, modelo e ano do veiculo.
// Esses sao os IDs padrao usados em categorias automotivas do ML Brasil.
const BRAND_ATTRIBUTE_IDS = new Set(["BRAND", "MARCA", "VEHICLE_BRAND"]);
const MODEL_ATTRIBUTE_IDS = new Set(["MODEL", "MODELO", "VEHICLE_MODEL", "PART_NUMBER"]);
const YEAR_ATTRIBUTE_IDS = new Set(["VEHICLE_YEAR", "YEAR", "ANO", "VEHICLE_YEARS"]);

function extractAttribute(attributes, idSet) {
  if (!Array.isArray(attributes)) return null;
  for (const attr of attributes) {
    if (attr?.id && idSet.has(attr.id.toUpperCase())) {
      return attr.value_name || attr.value_struct?.value || null;
    }
  }
  return null;
}

async function fetchItemsDetails(accessToken, itemIds) {
  if (!itemIds.length) return [];

  // ML allows up to 20 IDs per multi-get request
  const BATCH = 20;
  const results = [];

  for (let i = 0; i < itemIds.length; i += BATCH) {
    const batch = itemIds.slice(i, i + BATCH);
    const ids = batch.join(",");
    const response = await fetch(
      `https://api.mercadolibre.com/items?ids=${ids}&attributes=id,seller_sku,title,available_quantity,sold_quantity,initial_quantity,status,condition,listing_type_id,price,thumbnail,attributes`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) continue;

    const payload = await response.json();
    if (Array.isArray(payload)) {
      for (const entry of payload) {
        if (entry?.code === 200 && entry?.body) {
          results.push(entry.body);
        }
      }
    }
  }

  return results;
}

async function syncStock(connection) {
  const now = nowIso();
  let offset = 0;
  let totalSynced = 0;

  while (true) {
    const page = await fetchItemsPage(connection.access_token, connection.seller_id, offset);
    const itemIds = Array.isArray(page.results) ? page.results : [];

    if (itemIds.length === 0) break;

    const details = await fetchItemsDetails(connection.access_token, itemIds);

    const rows = details.map((item) => ({
      id: randomUUID(),
      connection_id: connection.id,
      seller_id: String(connection.seller_id),
      item_id: String(item.id),
      sku: item.seller_sku || null,
      title: item.title || null,
      available_quantity: Number(item.available_quantity ?? 0),
      sold_quantity: Number(item.sold_quantity ?? 0),
      total_quantity: Number(item.initial_quantity ?? 0),
      status: item.status || null,
      condition: item.condition || null,
      listing_type: item.listing_type_id || null,
      price: item.price != null ? Number(item.price) : null,
      thumbnail: item.thumbnail || null,
      brand: extractAttribute(item.attributes, BRAND_ATTRIBUTE_IDS),
      model: extractAttribute(item.attributes, MODEL_ATTRIBUTE_IDS),
      vehicle_year: extractAttribute(item.attributes, YEAR_ATTRIBUTE_IDS),
      synced_at: now,
      created_at: now,
      updated_at: now,
    }));

    upsertStockItems(rows);
    totalSynced += rows.length;
    offset += itemIds.length;

    const total = Number(page.paging?.total ?? 0);
    if (itemIds.length < STOCK_PAGE_LIMIT || (total > 0 && offset >= total)) break;
  }

  stockCacheTimestamp = Date.now();
  return totalSynced;
}

function getStockFromDb(connectionId) {
  return db
    .prepare(
      `SELECT item_id, sku, title, available_quantity, sold_quantity,
              total_quantity, status, condition, listing_type, price, thumbnail,
              brand, model, vehicle_year, synced_at
       FROM ml_stock
       WHERE connection_id = ?
       ORDER BY available_quantity DESC`
    )
    .all(connectionId);
}

export default async function mlStockHandler(req, res) {
  const profile = requireAuthenticatedProfile(req, res);
  if (!profile) return;

  const connectionId = req.query.connection_id;
  if (!connectionId) {
    return res.status(400).json({ error: "connection_id obrigatório" });
  }

  const baseConnection = getConnectionById(connectionId);
  if (!baseConnection) {
    return res.status(404).json({ error: "Conexão não encontrada" });
  }

  if (req.method === "POST") {
    // Force sync
    try {
      const connection = await ensureValidAccessToken(baseConnection);
      const totalSynced = await syncStock(connection);
      return res.json({ success: true, total_synced: totalSynced });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // GET — return cached stock, trigger background sync if stale
  const isCacheStale = Date.now() - stockCacheTimestamp > STOCK_CACHE_TTL_MS;
  const items = getStockFromDb(connectionId);

  if (isCacheStale && items.length > 0) {
    // Refresh in background without blocking response
    ensureValidAccessToken(baseConnection)
      .then((conn) => syncStock(conn))
      .catch(() => {});
  }

  return res.json({ items, stale: isCacheStale && items.length > 0 });
}
