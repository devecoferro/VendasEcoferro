// Dispara scraper (se nao tiver cache) e extrai order_ids por tab
// a partir das XHR responses. Cruza com ml_orders pra mapear
// (ss|sss|lt|os) -> tab ML.
import Database from "better-sqlite3";
import {
  scrapeMlSellerCenterFull,
  getCachedFullResult,
} from "/app/api/ml/_lib/seller-center-scraper.js";

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

let result = getCachedFullResult();
if (!result) {
  console.log("[extract] cache vazio, rodando scraper...");
  result = await scrapeMlSellerCenterFull({ timeoutMs: 90_000, stores: ["all"] });
} else {
  console.log("[extract] usando cache");
}

const db = new Database("/app/data/ecoferro.db", { readonly: true });
const getOrderRaw = db.prepare("SELECT raw_data FROM ml_orders WHERE order_id = ? LIMIT 1");

const mapping = new Map(); // (ss|sss|lt|os) -> Map(tab -> count)
const ordersByTab = new Map(); // tab -> Set(order_id)

function extractOrdersFromXhr(xhr) {
  const body = xhr.body;
  if (!body || typeof body !== "object") return [];
  // ML pode retornar em: body.results, body.items, body.packs, body.data.results, body.list
  const candidates = [
    body.results, body.items, body.packs, body.orders,
    body.data?.results, body.data?.items, body.data?.packs,
    body.list, body.content?.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  // Se body tem chaves numericas, tenta valores
  if (!Array.isArray(body)) {
    const vals = Object.values(body);
    if (vals.length > 0 && vals[0] && typeof vals[0] === "object") {
      // heuristica: se tem muitos valores todos com mesma shape, e lista
      if (vals.length > 3 && vals.every(v => v && (v.id || v.order_id || v.pack_id))) {
        return vals;
      }
    }
  }
  return [];
}

for (const [tabName, stores] of Object.entries(result?.tabs || {})) {
  for (const [storeName, storeData] of Object.entries(stores || {})) {
    const xhrs = storeData?.xhr_responses || [];
    // Procura o XHR que retornou lista de pedidos
    for (const xhr of xhrs) {
      if (!xhr.url) continue;
      // URL tipica: /sales-omni/packs/marketshops/list ou /vendas/omni/lista
      if (!/list|packs/.test(xhr.url)) continue;
      const orders = extractOrdersFromXhr(xhr);
      if (orders.length === 0) continue;

      if (!ordersByTab.has(tabName)) ordersByTab.set(tabName, new Set());
      const tabSet = ordersByTab.get(tabName);

      for (const o of orders) {
        const orderId = String(o.order_id || o.orderId || o.id || o.pack_id || "");
        if (!orderId) continue;
        tabSet.add(orderId);

        const row = getOrderRaw.get(orderId);
        if (!row) continue;
        const raw = safeJson(row.raw_data);
        if (!raw) continue;
        const ss = String(raw.shipment_snapshot?.status || "-");
        const sss = String(raw.shipment_snapshot?.substatus || "-");
        const lt = String(raw.shipment_snapshot?.logistic_type || "-");
        const os = String(raw.status || "-");
        const key = `${ss} | ${sss} | ${lt} | ${os}`;
        if (!mapping.has(key)) mapping.set(key, new Map());
        const inner = mapping.get(key);
        inner.set(tabName, (inner.get(tabName) || 0) + 1);
      }
    }
  }
}

console.log("\n=== Pedidos capturados por tab ML ===");
for (const [tab, ids] of ordersByTab) {
  console.log(`  ${tab}: ${ids.size} orders`);
}

console.log("\n=== MAPPING (ss|sss|lt|os) -> tab ML ===");
for (const [k, tabs] of [...mapping.entries()].sort()) {
  const parts = [...tabs.entries()].map(([t, n]) => `${t}:${n}`).join(", ");
  console.log(`  ${k}  ->  ${parts}`);
}

// Foca nos 'pending | buffered' suspeitos
console.log("\n=== FOCO: pending|buffered em qual tab ML ===");
const bufferedInTabs = new Map();
for (const [tab, ids] of ordersByTab) {
  for (const id of ids) {
    const row = getOrderRaw.get(id);
    if (!row) continue;
    const raw = safeJson(row.raw_data);
    if (!raw) continue;
    if (raw.shipment_snapshot?.status === "pending" && raw.shipment_snapshot?.substatus === "buffered") {
      bufferedInTabs.set(tab, (bufferedInTabs.get(tab) || 0) + 1);
    }
  }
}
for (const [tab, n] of bufferedInTabs) console.log(`  ${tab}: ${n}`);
