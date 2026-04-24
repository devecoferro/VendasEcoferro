// Debug: compara order_ids do scraper visual (chip ML) com os do classifier local.
// Resposta: o que o scraper visual EXCLUI e o classifier local INCLUI em in_transit?

import { getCachedLiveSnapshot } from "../api/ml/_lib/seller-center-scraper.js";
import { buildDashboardPayload } from "../api/ml/dashboard.js";
import { db } from "../api/_lib/db.js";

const snap = getCachedLiveSnapshot("all");
if (!snap) {
  console.log("Sem cache scraper — nao da pra comparar agora");
  process.exit(1);
}
const snapData = snap.data || snap;

console.log("=== SCRAPER VISUAL (chip ML) ===");
console.log("capturedAt:", snapData.capturedAt || snap.capturedAt || "n/a");
console.log("counters:", JSON.stringify(snapData.counters));
const scraperOrders = snapData.orders || {};
const scraperByBucket = {};
for (const bucket of ["today", "upcoming", "in_transit", "finalized"]) {
  const list = scraperOrders[bucket] || [];
  scraperByBucket[bucket] = new Set(
    list.map((o) => String(o.order_id || o.pack_id || "")).filter(Boolean)
  );
  console.log(`${bucket}: ${list.length} orders`);
}

console.log("\n=== CLASSIFIER LOCAL (API oficial) ===");
const payload = await buildDashboardPayload({ allowCache: false });
const localByBucket = {};
for (const bucket of ["today", "upcoming", "in_transit", "finalized"]) {
  const ids = payload.ml_live_chip_order_ids_by_bucket?.[bucket] || [];
  localByBucket[bucket] = new Set(ids.map(String));
  console.log(`${bucket}: ${ids.length} orders`);
}

console.log("\n=== DELTA: orders que local TEM e scraper NAO TEM ===");
for (const bucket of ["today", "upcoming", "in_transit", "finalized"]) {
  const onlyLocal = [...localByBucket[bucket]].filter((id) => !scraperByBucket[bucket].has(id));
  console.log(`\n${bucket}: local tem ${localByBucket[bucket].size}, scraper tem ${scraperByBucket[bucket].size}, diff=${onlyLocal.length}`);

  if (onlyLocal.length === 0) continue;

  // Pega detalhes dos primeiros 10 missing
  const sample = onlyLocal.slice(0, 10);
  const placeholders = sample.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT order_id,
              json_extract(raw_data, '$.shipment_snapshot.status') s,
              json_extract(raw_data, '$.shipment_snapshot.substatus') ss,
              json_extract(raw_data, '$.shipment_snapshot.logistic_type') lt,
              order_status os,
              sale_date,
              json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped') date_shipped
       FROM ml_orders WHERE order_id IN (${placeholders})`
    )
    .all(...sample);
  console.log(`  Amostra (primeiros 10 dos ${onlyLocal.length}):`);
  for (const r of rows) {
    console.log(`    ${r.order_id}: ${r.s}/${r.ss || "-"} ${r.lt}/${r.os} sale=${String(r.sale_date).slice(0, 10)} shipped=${r.date_shipped ? String(r.date_shipped).slice(0, 10) : "-"}`);
  }

  // Breakdown agregado por combo status
  const comboRows = db
    .prepare(
      `SELECT json_extract(raw_data, '$.shipment_snapshot.status') s,
              json_extract(raw_data, '$.shipment_snapshot.substatus') ss,
              COUNT(*) n
       FROM ml_orders WHERE order_id IN (${onlyLocal.map(() => "?").join(",")})
       GROUP BY 1,2 ORDER BY n DESC`
    )
    .all(...onlyLocal);
  console.log(`  Breakdown completo dos ${onlyLocal.length} divergentes:`);
  for (const r of comboRows) {
    console.log(`    ${r.s}/${r.ss || "-"}: ${r.n}`);
  }
}

console.log("\n=== DELTA INVERSO: scraper TEM e local NAO TEM ===");
for (const bucket of ["today", "upcoming", "in_transit", "finalized"]) {
  const onlyScraper = [...scraperByBucket[bucket]].filter((id) => !localByBucket[bucket].has(id));
  if (onlyScraper.length > 0) {
    console.log(`${bucket}: ${onlyScraper.length} orders so no scraper. Amostra: ${onlyScraper.slice(0, 5).join(", ")}`);
  }
}

process.exit(0);
