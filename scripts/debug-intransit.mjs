// Debug específico: os 107 pedidos do in_transit do classifier local
// (que o scraper visual reduz pra ~10). Quebra por substatus e freshness.

import { buildDashboardPayload } from "../api/ml/dashboard.js";
import { db } from "../api/_lib/db.js";

const payload = await buildDashboardPayload({ allowCache: false });
const inTransitIds = payload.ml_live_chip_order_ids_by_bucket?.in_transit || [];

console.log(`Classifier local in_transit: ${inTransitIds.length} order_ids`);
console.log(`ml_live_chip_counts.in_transit: ${payload.ml_live_chip_counts?.in_transit}`);
console.log(`ml_ui_chip_counts.in_transit: ${payload.ml_ui_chip_counts?.in_transit ?? "null"} (stale=${payload.ml_ui_chip_counts_stale})`);
console.log("Primeiros 5 IDs:", inTransitIds.slice(0, 5));

// Sample: ver se a 1a existe no DB
const firstRow = db.prepare(`SELECT order_id, id FROM ml_orders WHERE order_id = ? LIMIT 1`).get(String(inTransitIds[0]));
console.log("Primeiro ID no DB:", firstRow || "NÃO ENCONTRADO — order_id não bate");
// Tenta como id (db row id)
if (!firstRow) {
  const byId = db.prepare(`SELECT order_id, id FROM ml_orders WHERE id = ? LIMIT 1`).get(String(inTransitIds[0]));
  console.log("Como id (db row):", byId || "NÃO ENCONTRADO");
}

if (inTransitIds.length === 0) {
  console.log("Sem IDs — abortando");
  process.exit(0);
}

// IDs vem no formato "<ml_order_id>:<item_id>" (db row id). Faz IN com id.
const placeholders = inTransitIds.map(() => "?").join(",");
const rows = db
  .prepare(
    `SELECT json_extract(raw_data, '$.shipment_snapshot.status') s,
            json_extract(raw_data, '$.shipment_snapshot.substatus') ss,
            json_extract(raw_data, '$.shipment_snapshot.logistic_type') lt,
            order_status os,
            COUNT(*) n,
            MIN(sale_date) oldest_sale,
            MAX(sale_date) newest_sale,
            MIN(json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped')) oldest_shipped,
            MAX(json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped')) newest_shipped
     FROM ml_orders WHERE id IN (${placeholders})
     GROUP BY 1,2,3,4 ORDER BY n DESC`
  )
  .all(...inTransitIds);

console.log("\nBreakdown dos in_transit locais (status/substatus/lt/os → count):\n");
console.log("status                   substatus                   lt              os        n   shipped_range");
console.log("-".repeat(130));
for (const r of rows) {
  const shipRange = r.oldest_shipped
    ? `${String(r.oldest_shipped).slice(0, 10)} → ${String(r.newest_shipped).slice(0, 10)}`
    : "(sem date_shipped)";
  const line =
    `${(r.s || "").padEnd(25)} ` +
    `${(r.ss || "-").padEnd(27)} ` +
    `${(r.lt || "-").padEnd(15)} ` +
    `${(r.os || "-").padEnd(9)} ` +
    `${String(r.n).padStart(3)}  ${shipRange}`;
  console.log(line);
}

// Quantos shipped_date < 2d (hoje)?
const today = new Date();
const cutoff2d = new Date(today.getTime() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const cutoff7d = new Date(today.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

const recent2dRows = db
  .prepare(
    `SELECT COUNT(*) n FROM ml_orders WHERE order_id IN (${placeholders})
     AND json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped') >= ?`
  )
  .get(...inTransitIds, cutoff2d);

const recent7dRows = db
  .prepare(
    `SELECT COUNT(*) n FROM ml_orders WHERE order_id IN (${placeholders})
     AND json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped') >= ?`
  )
  .get(...inTransitIds, cutoff7d);

console.log(`\nRecência dos 107 in_transit:`);
console.log(`  shipped >= 2 dias atrás (${cutoff2d}): ${recent2dRows?.n || 0}`);
console.log(`  shipped >= 7 dias atrás (${cutoff7d}): ${recent7dRows?.n || 0}`);
console.log(`  total: ${inTransitIds.length}`);

// Hipótese: chip visual ~10. Se shipped_2d for ~10, significa ML usa janela 2d.
// Se shipped_2d for muito mais que 10, é dedup mais agressivo OU outro filtro.
process.exit(0);
