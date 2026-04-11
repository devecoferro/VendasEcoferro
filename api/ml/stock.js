import { randomUUID } from "node:crypto";
import { db } from "../_lib/db.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getConnectionById } from "./_lib/storage.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

const STOCK_PAGE_LIMIT = 100;
const STOCK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Normalizacao de marca/modelo/ano ───────────────────────────────
// Os atributos do ML frequentemente contem dados sujos (titulo inteiro
// no campo BRAND, SKU no campo MODEL, etc.). Essa logica extrai os
// valores corretos combinando atributos + titulo do anuncio.

const KNOWN_BRANDS = [
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Ducati", "Triumph",
  "Harley-Davidson", "KTM", "Husqvarna", "Royal Enfield", "Kasinski",
  "Benelli", "MV Agusta", "Aprilia", "Dafra", "Shineray",
];
// Variacoes com typos comuns encontrados nos anuncios ML
const BRAND_ALIASES = {
  kawazaki: "Kawasaki",
  kavasaki: "Kawasaki",
  "harley davidson": "Harley-Davidson",
  ecofero: "Ecoferro",
  fanton: "Fantom",
};
const OWN_BRANDS = ["Ecoferro", "Fantom"];

// Modelos conhecidos por marca — usado para extrair do titulo
const KNOWN_MODELS = {
  Honda: [
    "Hornet", "CB 600F", "CB600F", "CB 1000R", "CB1000R", "CBR 600F", "CBR600F",
    "CBR 600RR", "CBR600RR", "NC 700", "NC700", "NC 750", "NC750",
    "XRE 300", "XRE300", "CB 300", "CB300", "CB 300F", "CB300F",
    "Twister 250", "Twister", "ADV 150", "ADV150", "ADV 160", "ADV160",
    "Tornado", "Bros", "Sahara 300", "Sahara",
    "CB 500F", "CB500F", "CB 500X", "CB500X", "CBR 500R", "CBR500R",
    "CB 650F", "CB650F", "CBR 650F", "CBR650F",
    "CB 650R", "CB650R", "CBR 650R", "CBR650R",
    "CG 160", "CG160", "PCX 150", "PCX150", "Elite 125",
    "Pop 110", "Biz 125", "NXR 160", "XRE 190",
  ],
  Yamaha: [
    "MT-07", "MT 07", "MT07", "MT-09", "MT 09", "MT09",
    "MT-03", "MT 03", "MT03", "R3", "R1", "R6",
    "XJ6", "XJ 6", "Fazer 250", "Fazer", "FZ25", "FZ 25",
    "Lander 250", "Lander", "XTZ 250", "XTZ250",
    "Crosser 150", "Crosser", "XT 660", "XT660",
    "Tenere 250", "Tenere 700", "Tenere",
    "NMAX", "XMAX", "Factor", "Fluo",
    "FZ15", "FZ 15", "Fazer 150",
  ],
  Suzuki: [
    "SRAD", "GSX-R 750", "GSXR750", "GSX-R750",
    "GSX-R 1000", "GSXR1000", "GSX-R1000",
    "Bandit", "GSR 750", "GSR750",
    "V-Strom", "VStrom", "DL 650", "DL 1000",
    "Hayabusa", "GSX-S 750", "GSX-S750",
    "Burgman",
  ],
  Kawasaki: [
    "Z800", "Z 800", "Z900", "Z 900", "Z1000", "Z 1000",
    "Z650", "Z 650", "Z400", "Z 400",
    "Ninja 300", "Ninja 400", "Ninja 650", "Ninja 1000",
    "ZX-10R", "ZX10R", "ZX-6R", "ZX6R",
    "ER-6N", "ER6N", "Versys", "Versys 650",
    "Vulcan",
  ],
  BMW: [
    "S1000RR", "S1000R", "S 1000",
    "R1200GS", "R 1200 GS", "R1200 GS",
    "R1250GS", "R 1250 GS", "R1250 GS",
    "F800", "F 800", "F850", "F 850",
    "G310R", "G 310R", "G310GS",
  ],
  Ducati: [
    "Monster", "Panigale", "Scrambler", "Multistrada", "Diavel",
  ],
  Triumph: [
    "Street Triple", "Tiger", "Bonneville", "Speed Triple", "Trident",
  ],
  Kasinski: [
    "Comet", "GTR 250", "Comet 250",
  ],
};

function normalizeBrand(rawBrand, title) {
  const text = `${rawBrand || ""} ${title || ""}`.toLowerCase();

  // Verifica aliases/typos primeiro
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (text.includes(alias)) {
      return canonical;
    }
  }

  // Procura marcas conhecidas no texto combinado
  for (const brand of KNOWN_BRANDS) {
    if (text.includes(brand.toLowerCase())) {
      return brand;
    }
  }

  // Verifica marcas proprias
  for (const brand of OWN_BRANDS) {
    if (text.includes(brand.toLowerCase())) {
      return brand;
    }
  }

  // "Universal" como marca para produtos genericos
  if (text.includes("universal")) {
    return "Universal";
  }

  // Se o rawBrand e curto e limpo (< 20 chars, sem numeros longos), usa direto
  if (rawBrand && rawBrand.length < 20 && !/\d{4}/.test(rawBrand)) {
    return rawBrand.trim();
  }

  return null;
}

function normalizeModel(rawModel, title, brand) {
  const brandModels = brand ? KNOWN_MODELS[brand] : null;

  if (brandModels) {
    // Procura o modelo mais longo que encaixa no titulo (mais especifico primeiro)
    const sortedModels = [...brandModels].sort((a, b) => b.length - a.length);
    const searchText = `${title || ""} ${rawModel || ""}`;

    for (const model of sortedModels) {
      if (searchText.toLowerCase().includes(model.toLowerCase())) {
        // Retorna a versao canonica (com formato padrao)
        return model;
      }
    }
  }

  // Se rawModel e um codigo SKU (ex: "KA001C", "EC004"), ignora
  if (rawModel && /^[A-Z]{2}\d{3}/.test(rawModel)) {
    return null;
  }

  // Se rawModel e o nome de uma marca, ignora
  if (rawModel && [...KNOWN_BRANDS, ...OWN_BRANDS].some(
    (b) => b.toLowerCase() === rawModel.toLowerCase()
  )) {
    return null;
  }

  // Se rawModel e curto e limpo, usa
  if (rawModel && rawModel.length > 1 && rawModel.length < 30 && rawModel !== "Universal") {
    return rawModel.trim();
  }

  return null;
}

function extractYearsFromTitle(title) {
  if (!title) return [];
  // Encontra todos os anos entre 2000 e 2030 no titulo
  const yearMatches = title.match(/\b(20[0-3]\d)\b/g);
  if (!yearMatches) return [];
  // Remove duplicatas e ordena
  return [...new Set(yearMatches)].sort();
}

function normalizeStockItem(item) {
  const brand = normalizeBrand(item.brand, item.title);
  const model = normalizeModel(item.model, item.title, brand);
  const years = extractYearsFromTitle(item.title);
  // Combina anos em uma faixa legivel (ex: "2010-2016") ou lista curta
  let yearDisplay = null;
  if (years.length > 0) {
    if (years.length <= 2) {
      yearDisplay = years.join(", ");
    } else {
      yearDisplay = `${years[0]}-${years[years.length - 1]}`;
    }
  }

  return {
    ...item,
    brand: brand,
    model: model,
    vehicle_year: yearDisplay,
  };
}

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
  const rawItems = getStockFromDb(connectionId);
  const items = rawItems.map(normalizeStockItem);

  if (isCacheStale && rawItems.length > 0) {
    // Refresh in background without blocking response
    ensureValidAccessToken(baseConnection)
      .then((conn) => syncStock(conn))
      .catch(() => {});
  }

  return res.json({ items, stale: isCacheStale && rawItems.length > 0 });
}
