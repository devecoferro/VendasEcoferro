// All-in-one: roda scraper, inspeciona XHRs, e extrai order_ids por tab.
import fs from "node:fs";
import Database from "better-sqlite3";
import { scrapeMlSellerCenterFull } from "/app/api/ml/_lib/seller-center-scraper.js";

console.log("[scrape-extract] iniciando...");
const result = await scrapeMlSellerCenterFull({ timeoutMs: 90_000, stores: ["all"] });
console.log("[scrape-extract] scraper terminou, salvando em /tmp/scrape-result.json");
fs.writeFileSync("/tmp/scrape-result.json", JSON.stringify(result, null, 2));

// Inspeciona URLs pra cada tab/store
for (const [tabName, stores] of Object.entries(result.tabs || {})) {
  for (const [storeName, storeData] of Object.entries(stores || {})) {
    const xhrs = storeData?.xhr_responses || [];
    console.log(`\n=== ${tabName} / ${storeName} (${xhrs.length} XHRs) ===`);
    // Lista URLs que retornaram objetos com body (filtra HTML/assets)
    for (const x of xhrs) {
      if (!x.body || typeof x.body !== "object") continue;
      const keys = Object.keys(x.body).slice(0, 8).join(",");
      const url = (x.url || "").replace("https://www.mercadolivre.com.br", "").slice(0, 120);
      console.log(`  [${x.status}] ${url}  keys=[${keys}]`);
    }
  }
}

// Tenta extrair pedidos de qualquer array no body
console.log("\n\n=== BUSCA POR ARRAYS DE PEDIDOS ===");
function findOrderArrays(obj, path = "", depth = 0) {
  if (!obj || depth > 5) return [];
  const hits = [];
  if (Array.isArray(obj)) {
    if (obj.length > 2 && obj[0] && typeof obj[0] === "object") {
      const firstKeys = Object.keys(obj[0]);
      // Procura por identificadores de pedido
      const hasIdField = firstKeys.some(k => /order_id|pack_id|packId|^id$/i.test(k));
      if (hasIdField) hits.push({ path, count: obj.length, sample: obj[0] });
    }
    return hits;
  }
  if (typeof obj !== "object") return [];
  for (const [k, v] of Object.entries(obj)) {
    hits.push(...findOrderArrays(v, path ? `${path}.${k}` : k, depth + 1));
  }
  return hits;
}

for (const [tabName, stores] of Object.entries(result.tabs || {})) {
  for (const [storeName, storeData] of Object.entries(stores || {})) {
    const xhrs = storeData?.xhr_responses || [];
    for (const x of xhrs) {
      if (!x.body) continue;
      const hits = findOrderArrays(x.body);
      if (hits.length === 0) continue;
      for (const h of hits) {
        console.log(`\n${tabName}/${storeName}  URL: ${(x.url||"").slice(0,100)}`);
        console.log(`  path: ${h.path}  count: ${h.count}`);
        console.log(`  sample keys: ${Object.keys(h.sample).slice(0,15).join(", ")}`);
        console.log(`  sample: ${JSON.stringify(h.sample).slice(0, 600)}`);
      }
    }
  }
}
