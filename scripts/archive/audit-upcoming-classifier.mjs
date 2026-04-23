// Script de auditoria: mostra breakdown dos pedidos por
// (ship_status, ship_substatus, logistic_type) e qual bucket nosso
// classifier diz que eles pertencem. Uso pra caçar pedidos "poluindo"
// o bucket upcoming.
//
// Rodar dentro do container: node scripts/audit-upcoming-classifier.mjs

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || "/app/data/ecoferro.db";

// Replica do classifier (simplificado, precisa importar o real)
// Pra simplificar, importa via dynamic import do codigo real.
const { getOrderPrimaryBucket, getOrderSubstatus } = await import(
  path.resolve(__dirname, "../src/services/mlSubStatusClassifier.ts")
).catch(async () => {
  // TS nao roda direto em Node — fallback: replica a logica minima.
  // Na pratica vamos inferir bucket pelo proprio raw_data.
  return { getOrderPrimaryBucket: null, getOrderSubstatus: null };
});

const db = new Database(DB_PATH, { readonly: true });

console.log("=== Breakdown por (ship_status, ship_substatus, logistic) ===\n");
const breakdown = db.prepare(`
  SELECT
    json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
    json_extract(raw_data, '$.shipment_snapshot.substatus') AS ship_substatus,
    json_extract(raw_data, '$.shipment_snapshot.logistic_type') AS logistic,
    json_extract(raw_data, '$.status') AS order_status,
    COUNT(*) AS n
  FROM ml_orders
  GROUP BY ship_status, ship_substatus, logistic, order_status
  ORDER BY n DESC
`).all();

console.log(
  ["status", "substatus", "logistic", "order", "n"].join(" | ")
);
console.log("-".repeat(80));
for (const r of breakdown) {
  console.log(
    [
      r.ship_status || "-",
      r.ship_substatus || "-",
      r.logistic || "-",
      r.order_status || "-",
      r.n,
    ].join(" | ")
  );
}
console.log();

// Pra comparar com ML live-snapshot (scraper):
console.log("=== Lendo live snapshot cache (se existir) ===");
try {
  const snap = db.prepare(`
    SELECT snapshot_json FROM ml_live_snapshots
    ORDER BY captured_at DESC LIMIT 1
  `).get();
  if (snap) {
    const s = JSON.parse(snap.snapshot_json);
    console.log("chips:", JSON.stringify(s.chips || s.buckets, null, 2));
  } else {
    console.log("(sem snapshot no DB)");
  }
} catch (e) {
  console.log("erro lendo snapshot:", e.message);
}

console.log("\n=== Orders em 'ready_to_ship/handling' (candidatos upcoming) ===\n");
const upcomingCandidates = db.prepare(`
  SELECT
    order_id,
    json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
    json_extract(raw_data, '$.shipment_snapshot.substatus') AS ship_substatus,
    json_extract(raw_data, '$.shipment_snapshot.logistic_type') AS logistic,
    json_extract(raw_data, '$.shipment_snapshot.pickup_date') AS pickup,
    json_extract(raw_data, '$.shipment_snapshot.shipping_option.estimated_schedule_limit.date') AS eschedule,
    json_extract(raw_data, '$.shipment_snapshot.sla_snapshot.expected_date') AS sla,
    json_extract(raw_data, '$.shipment_snapshot.lead_time.estimated_schedule_limit.date') AS lead_sched
  FROM ml_orders
  WHERE json_extract(raw_data, '$.shipment_snapshot.status')
    IN ('ready_to_ship', 'handling', 'pending')
  LIMIT 25
`).all();
for (const r of upcomingCandidates) {
  console.log(r);
}
