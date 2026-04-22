// Replica da logica do classifier em JS puro pra auditar buckets reais
// sem precisar do TS. Roda de /app dentro do container.
import Database from "better-sqlite3";

const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });

function coerceDate(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.date) return v.date;
  return null;
}

function parsePickupDate(raw) {
  const ship = raw.shipment_snapshot || {};
  const opts = [
    coerceDate(ship.pickup_date),
    coerceDate(ship.estimated_delivery_limit),
    coerceDate(ship.shipping_option?.estimated_schedule_limit),
    coerceDate(ship.shipping_option?.estimated_delivery_limit),
    coerceDate(ship.shipping_option?.estimated_delivery_final),
    coerceDate(ship.lead_time?.estimated_schedule_limit),
    coerceDate(ship.lead_time?.estimated_delivery_limit),
    coerceDate(ship.sla_snapshot?.expected_date),
    coerceDate(raw.pickup_date),
    coerceDate(raw.shipping?.pickup_date),
  ];
  for (const s of opts) {
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return { date: d, field: opts.indexOf(s) };
  }
  return null;
}

const PICKUP_FIELDS = [
  "pickup_date",
  "estimated_delivery_limit",
  "shipping_option.estimated_schedule_limit",
  "shipping_option.estimated_delivery_limit",
  "shipping_option.estimated_delivery_final",
  "lead_time.estimated_schedule_limit",
  "lead_time.estimated_delivery_limit",
  "sla_snapshot.expected_date",
  "raw.pickup_date",
  "raw.shipping.pickup_date",
];

const ACTIVE_RETURN_SUBSTATUSES = new Set([
  "returning_to_sender",
  "returning_to_hub",
  "delayed",
  "return_failed",
]);

function getPrimaryBucket(raw) {
  const ss = String(raw.shipment_snapshot?.status || "").toLowerCase();
  const sss = String(raw.shipment_snapshot?.substatus || "").toLowerCase();
  const os = String(raw.status || "").toLowerCase();
  const isCancelled = os === "cancelled" || ss === "cancelled";
  const wasShipped = ["shipped", "delivered", "not_delivered"].includes(ss);

  if (ss === "delivered" || ss === "returned") return "finalized";
  if (ss === "not_delivered") {
    if (ACTIVE_RETURN_SUBSTATUSES.has(sss)) return "in_transit";
    return "finalized";
  }
  if (isCancelled) {
    if (wasShipped) return "finalized";
    const dc = raw.date_closed;
    if (dc) {
      const ageDays = (Date.now() - new Date(dc).getTime()) / (24 * 3600 * 1000);
      if (Number.isFinite(ageDays) && ageDays > 2) return "finalized";
    }
    return "today";
  }
  // business rule: shipped+waiting_for_withdrawal = finalized
  if (ss === "shipped" && sss === "waiting_for_withdrawal") return "finalized";

  if (ss === "shipped" || ss === "in_transit" || ss === "ready_for_pickup") return "in_transit";

  // novo: ready_to_ship + substatus "ja saiu" → in_transit
  const shippedOutSubstatuses = new Set(["picked_up", "dropped_off", "soon_deliver", "out_for_delivery"]);
  if (ss === "ready_to_ship" && shippedOutSubstatuses.has(sss)) return "in_transit";

  const pd = parsePickupDate(raw);
  if (pd) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const t = new Date(pd.date); t.setHours(0, 0, 0, 0);
    return t.getTime() <= today.getTime() ? "today" : "upcoming";
  }
  return "upcoming"; // fallback
}

const rows = db.prepare("SELECT order_id, raw_data FROM ml_orders").all();
console.log(`total orders: ${rows.length}`);

const byBucket = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
const upcomingBreakdown = new Map();
const upcomingByPickupSource = new Map();
const upcomingNoPickup = []; // orders que caem via FALLBACK sem pickup

for (const row of rows) {
  const raw = JSON.parse(row.raw_data);
  const bucket = getPrimaryBucket(raw);
  byBucket[bucket] = (byBucket[bucket] || 0) + 1;

  if (bucket === "upcoming") {
    const ss = String(raw.shipment_snapshot?.status || "-");
    const sss = String(raw.shipment_snapshot?.substatus || "-");
    const lt = String(raw.shipment_snapshot?.logistic_type || "-");
    const os = String(raw.status || "-");
    const key = `${ss} | ${sss} | ${lt} | ${os}`;
    upcomingBreakdown.set(key, (upcomingBreakdown.get(key) || 0) + 1);

    const pd = parsePickupDate(raw);
    if (pd) {
      upcomingByPickupSource.set(
        PICKUP_FIELDS[pd.field],
        (upcomingByPickupSource.get(PICKUP_FIELDS[pd.field]) || 0) + 1
      );
    } else {
      upcomingNoPickup.push({ order_id: row.order_id, ss, sss, lt, os });
    }
  }
}

console.log("\n=== Buckets ===");
for (const [b, n] of Object.entries(byBucket)) console.log(`  ${b}: ${n}`);

console.log("\n=== Detalhe UPCOMING (status | substatus | logistic | order_status) ===");
for (const [k, n] of [...upcomingBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} - ${k}`);
}

console.log("\n=== UPCOMING: campo de data usado ===");
for (const [f, n] of [...upcomingByPickupSource.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} - ${f}`);
}

console.log(`\n=== UPCOMING via FALLBACK (sem pickup date): ${upcomingNoPickup.length} ===`);
const fbBreak = new Map();
for (const o of upcomingNoPickup) {
  const k = `${o.ss} | ${o.sss} | ${o.lt} | ${o.os}`;
  fbBreak.set(k, (fbBreak.get(k) || 0) + 1);
}
for (const [k, n] of [...fbBreak.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} - ${k}`);
}
