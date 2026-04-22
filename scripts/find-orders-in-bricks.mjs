// Procura order IDs em TODOS os bricks de TODAS as tabs/stores
// e mapeia (ss|sss|lt|os) -> tab ML.
import fs from "node:fs";
import Database from "better-sqlite3";

const r = JSON.parse(fs.readFileSync("/tmp/scrape-result.json", "utf8"));
const db = new Database("/app/data/ecoferro.db", { readonly: true });
const getOrderRaw = db.prepare("SELECT raw_data FROM ml_orders WHERE order_id = ? LIMIT 1");

// ML order IDs: 16 digits, prefixo 2000
const ORDER_ID_REGEX = /2000\d{12}/g;

const ordersByTab = new Map(); // tab -> Set(orderId)
const mapping = new Map(); // (ss|sss|lt|os) -> Map(tab -> count)

// Procura recursivamente pelo brick 'list_marketshops' e extrai
// order_ids SÓ de dentro dele (evita vazamento de sidebar/inbox).
function findListBrick(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.id === "list_marketshops") return obj;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findListBrick(v);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(obj)) {
    const found = findListBrick(v);
    if (found) return found;
  }
  return null;
}

for (const [tabName, stores] of Object.entries(r.tabs || {})) {
  if (!ordersByTab.has(tabName)) ordersByTab.set(tabName, new Set());
  const tabSet = ordersByTab.get(tabName);

  for (const [storeName, storeData] of Object.entries(stores || {})) {
    if (storeName !== "all") continue;
    const xhrs = storeData?.xhr_responses || [];
    for (const x of xhrs) {
      const listBrick = findListBrick(x.body);
      if (!listBrick) continue;
      // Procura order_ids SO dentro desse brick
      const str = JSON.stringify(listBrick);
      const matches = str.match(ORDER_ID_REGEX);
      if (!matches) continue;
      for (const id of matches) tabSet.add(id);
    }
  }
}

console.log("=== Orders encontrados por tab ML (scraper) ===");
for (const [tab, ids] of ordersByTab) {
  console.log(`  ${tab}: ${ids.size} orders`);
}

// Cross-reference com nossa base
let matched = 0;
for (const [tab, ids] of ordersByTab) {
  for (const id of ids) {
    const row = getOrderRaw.get(id);
    if (!row) continue;
    matched++;
    const raw = JSON.parse(row.raw_data);
    const ss = String(raw.shipment_snapshot?.status || "-");
    const sss = String(raw.shipment_snapshot?.substatus || "-");
    const lt = String(raw.shipment_snapshot?.logistic_type || "-");
    const os = String(raw.status || "-");
    const key = `${ss} | ${sss} | ${lt} | ${os}`;
    if (!mapping.has(key)) mapping.set(key, new Map());
    const inner = mapping.get(key);
    inner.set(tab, (inner.get(tab) || 0) + 1);
  }
}

console.log(`\nMatched: ${matched} orders`);
console.log("\n=== MAPPING: (ss | sss | lt | os) -> tab ML ===");
for (const [k, tabs] of [...mapping.entries()].sort()) {
  const parts = [...tabs.entries()].map(([t, n]) => `${t}:${n}`).join(", ");
  console.log(`  ${k}  ->  ${parts}`);
}

// Foco nos pending|buffered
console.log("\n=== FOCO: pending|buffered em qual tab ML? ===");
const bufferedInTabs = new Map();
for (const [tab, ids] of ordersByTab) {
  for (const id of ids) {
    const row = getOrderRaw.get(id);
    if (!row) continue;
    const raw = JSON.parse(row.raw_data);
    if (raw.shipment_snapshot?.status === "pending" && raw.shipment_snapshot?.substatus === "buffered") {
      bufferedInTabs.set(tab, (bufferedInTabs.get(tab) || 0) + 1);
    }
  }
}
if (bufferedInTabs.size === 0) console.log("  nenhum pending|buffered no scraper (pode não estar no top 50 de cada tab)");
for (const [tab, n] of bufferedInTabs) console.log(`  ${tab}: ${n}`);

// Exemplo de 3 order_ids por tab pra debug
console.log("\n=== Amostra 3 order_ids por tab ===");
for (const [tab, ids] of ordersByTab) {
  console.log(`  ${tab}: ${[...ids].slice(0, 3).join(", ")}`);
}
