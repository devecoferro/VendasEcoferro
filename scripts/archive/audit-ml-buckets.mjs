// Auditoria rapida dos buckets e candidatos a upcoming.
// Roda dentro do container.
import Database from "better-sqlite3";
const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });

console.log("=== Breakdown por ship_status + substatus + logistic + order_status ===");
const breakdown = db.prepare(`
  SELECT
    json_extract(raw_data, '$.shipment_snapshot.status') AS ss,
    json_extract(raw_data, '$.shipment_snapshot.substatus') AS sss,
    json_extract(raw_data, '$.shipment_snapshot.logistic_type') AS lt,
    json_extract(raw_data, '$.status') AS os,
    COUNT(*) AS n
  FROM ml_orders
  GROUP BY ss, sss, lt, os
  ORDER BY n DESC
`).all();
for (const r of breakdown) {
  console.log([r.ss || "-", r.sss || "-", r.lt || "-", r.os || "-", r.n].join(" | "));
}

console.log("\n=== Orders que PODEM cair em upcoming (nao-terminal + pickup-like) ===");
const cand = db.prepare(`
  SELECT
    order_id,
    sale_date,
    json_extract(raw_data, '$.shipment_snapshot.status') AS ss,
    json_extract(raw_data, '$.shipment_snapshot.substatus') AS sss,
    json_extract(raw_data, '$.shipment_snapshot.logistic_type') AS lt,
    json_extract(raw_data, '$.status') AS os,
    json_extract(raw_data, '$.shipment_snapshot.pickup_date') AS pk,
    json_extract(raw_data, '$.shipment_snapshot.shipping_option.estimated_schedule_limit.date') AS esl,
    json_extract(raw_data, '$.shipment_snapshot.shipping_option.estimated_delivery_limit.date') AS edl,
    json_extract(raw_data, '$.shipment_snapshot.shipping_option.estimated_delivery_final.date') AS edf,
    json_extract(raw_data, '$.shipment_snapshot.sla_snapshot.expected_date') AS sla,
    json_extract(raw_data, '$.shipment_snapshot.lead_time.estimated_schedule_limit.date') AS lsl,
    json_extract(raw_data, '$.date_closed') AS dc
  FROM ml_orders
  WHERE (
    json_extract(raw_data, '$.shipment_snapshot.status') IN ('ready_to_ship','handling','pending')
    OR json_extract(raw_data, '$.status') = 'paid'
  )
`).all();

console.log(`total candidatos: ${cand.length}\n`);

// Conta quantos cairiam em upcoming SOMENTE por causa de cada campo de data
const byFirstPickupSource = new Map();
const today = new Date(); today.setHours(0,0,0,0);
const tomorrowMs = today.getTime() + 24*60*60*1000;

const FIELDS = ["pk","esl","edl","edf","sla","lsl"];
function firstUsable(row) {
  for (const f of FIELDS) {
    const v = row[f];
    if (!v) continue;
    const d = new Date(v); if (!Number.isNaN(d.getTime())) return { field: f, date: v };
  }
  return null;
}

const terminals = ["delivered","not_delivered","returned","cancelled"];
const suspicious = [];
for (const row of cand) {
  const isTerminal = terminals.includes(String(row.ss||"").toLowerCase()) ||
                     String(row.os||"").toLowerCase() === "cancelled";
  const src = firstUsable(row);
  if (src) {
    byFirstPickupSource.set(src.field, (byFirstPickupSource.get(src.field) || 0) + 1);
  }
  if (isTerminal && src) {
    suspicious.push({...row, src_field: src.field, src_date: src.date});
  }
}

console.log("=== Pedidos que cairiam em upcoming PELA PRIMEIRA fonte de data ===");
for (const [field, count] of [...byFirstPickupSource.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${field}: ${count}`);
}

console.log(`\n=== SUSPEITOS: terminais com data que poluiria upcoming (${suspicious.length}) ===`);
for (const r of suspicious.slice(0, 20)) {
  console.log(`  ${r.order_id}  ss=${r.ss} sss=${r.sss} os=${r.os}  data_via=${r.src_field}=${r.src_date}`);
}

console.log("\n=== Breakdown por order_status ===");
const bos = db.prepare(`
  SELECT json_extract(raw_data, '$.status') AS os, COUNT(*) AS n FROM ml_orders GROUP BY os ORDER BY n DESC
`).all();
for (const r of bos) console.log(`  ${r.os}: ${r.n}`);
