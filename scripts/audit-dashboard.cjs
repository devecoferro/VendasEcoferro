const path = require("path");
const db = require(path.join("/app", "node_modules", "better-sqlite3"))("/app/data/ecoferro.db");

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
console.log("=== AUDITORIA DASHBOARD ===");
console.log("Hoje (SP):", today);

const allOrders = db.prepare(`
  SELECT
    json_extract(raw_data, '$.shipment_snapshot.status') as ship_status,
    json_extract(raw_data, '$.shipment_snapshot.substatus') as ship_substatus,
    json_extract(raw_data, '$.shipment_snapshot.logistic_type') as logistic_type,
    json_extract(raw_data, '$.deposit_snapshot.logistic_type') as dep_logistic,
    json_extract(raw_data, '$.deposit_snapshot.key') as dep_key,
    json_extract(raw_data, '$.sla_snapshot.expected_date') as sla_date,
    json_extract(raw_data, '$.shipment_snapshot.shipping_option.estimated_delivery_limit') as ship_est,
    json_extract(raw_data, '$.pack_id') as pack_id,
    json_extract(raw_data, '$.shipment_snapshot.status_history.date_cancelled') as date_cancelled,
    json_extract(raw_data, '$.shipment_snapshot.status_history.date_not_delivered') as date_not_delivered,
    json_extract(raw_data, '$.shipment_snapshot.status_history.date_returned') as date_returned,
    json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped') as date_shipped,
    order_id, order_status, sale_date
  FROM ml_orders
  ORDER BY sale_date DESC
`).all();

console.log("Total orders in DB:", allOrders.length);

// Status breakdown
const statusGroups = {};
allOrders.forEach(o => {
  const key = `${o.ship_status || o.order_status}/${o.ship_substatus || "none"}`;
  statusGroups[key] = (statusGroups[key] || 0) + 1;
});
console.log("\n=== STATUS BREAKDOWN ===");
Object.entries(statusGroups).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Helpers
const SHIPPED_TRANSIT = new Set(["out_for_delivery", "receiver_absent", "not_visited", "at_customs"]);
const NOT_DEL_TRANSIT = new Set(["returning_to_sender", "returning_to_hub", "delayed", "return_failed"]);
const STALE_DAYS = { paid: 14, pending: 14, confirmed: 14, handling: 14, ready_to_ship: 30, shipped: 45, in_transit: 45 };

function getSlaKey(o) {
  const raw = o.sla_date || o.ship_est;
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function isFulfillment(o) {
  const lt = (o.logistic_type || o.dep_logistic || "").toLowerCase();
  const dk = (o.dep_key || "").toLowerCase();
  return lt === "fulfillment" || dk.startsWith("node:") || dk === "logistic:fulfillment";
}

function classify(o, todayKey) {
  const status = (o.ship_status || o.order_status || "").toLowerCase().trim();
  const sub = (o.ship_substatus || "none").toLowerCase().trim();
  const sla = getSlaKey(o);
  const full = isFulfillment(o);

  if (status === "ready_to_ship" || status === "handling") {
    if (full) {
      if (sub === "ready_to_pack") return "today";
      if (sub === "packed") return (sla && sla <= todayKey) ? "today" : (sla ? "upcoming" : "today");
      if (sub === "in_warehouse") return (sla && sla <= todayKey) ? "today" : "upcoming";
      return "upcoming";
    } else {
      if (["picked_up", "authorized_by_carrier"].includes(sub)) return "in_transit";
      if (["in_packing_list", "in_hub"].includes(sub)) return "upcoming";
      if (sub === "ready_for_pickup") return "today";
      if (sub === "packed") return (sla && sla <= todayKey) ? "today" : (sla ? "upcoming" : "today");
      if (sla) return sla <= todayKey ? "today" : "upcoming";
      return "upcoming";
    }
  }
  if (status === "shipped") {
    if (SHIPPED_TRANSIT.has(sub)) return "in_transit";
    if (sub === "none" || sub === "waiting_for_withdrawal" || sub === "claimed_me") {
      const shipKey = o.date_shipped ? o.date_shipped.substring(0, 10) : null;
      const shippedAge = shipKey ? Math.round((new Date(todayKey+"T00:00:00") - new Date(shipKey+"T00:00:00")) / 86400000) : 999;
      if (shippedAge <= 0) {
        return (sla && sla <= todayKey) ? "today" : "upcoming";
      }
      if (shippedAge === 1 && sla && sla <= todayKey) return "today";
      return null;
    }
    return null;
  }
  if (status === "in_transit") return "in_transit";
  if (status === "not_delivered") return NOT_DEL_TRANSIT.has(sub) ? "in_transit" : "finalized";
  if (status === "cancelled" || status === "returned") return "finalized";
  return null;
}

// Freshness filter
const now = Date.now();
const fresh = allOrders.filter(o => {
  if (!o.sale_date) return false;
  const sd = new Date(o.sale_date);
  const status = (o.ship_status || o.order_status || "").toLowerCase().trim();
  const th = STALE_DAYS[status];
  if (th == null) return true;
  return (now - sd.getTime()) / 86400000 <= th;
});
console.log("\nAfter freshness:", fresh.length, "(removed", allOrders.length - fresh.length, "stale)");

// Classify with pack dedup + finalized window
const buckets = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
const packs = new Set();
let nullCount = 0;

for (const o of fresh) {
  let bucket = classify(o, today);
  if (!bucket) { nullCount++; continue; }

  if (bucket === "finalized") {
    const exDate = o.date_cancelled || o.date_not_delivered || o.date_returned || o.sale_date;
    if (exDate) {
      const age = (now - new Date(exDate).getTime()) / 86400000;
      if (age > 2) continue;
    }
  }

  const pk = o.pack_id ? String(o.pack_id) : null;
  const dk = pk ? `${bucket}:${pk}` : null;
  if (dk && packs.has(dk)) continue;
  if (dk) packs.add(dk);

  buckets[bucket]++;
}

console.log("\n=== RESULTADO AUDITORIA ===");
console.log("Envios de hoje:", buckets.today);
console.log("Proximos dias:", buckets.upcoming);
console.log("Em transito:", buckets.in_transit);
console.log("Finalizadas:", buckets.finalized);
console.log("Nao operacional:", nullCount);
console.log("Total operacional:", buckets.today + buckets.upcoming + buckets.in_transit + buckets.finalized);

// ML numbers from screenshot
console.log("\n=== ML SELLER CENTER ===");
console.log("Envios de hoje: 3");
console.log("Proximos dias: 174");
console.log("Em transito: 9");
console.log("Finalizadas: 2");
console.log("Total: 188");

// Details
console.log("\n=== PEDIDOS 'PACKED' ===");
fresh.filter(o => (o.ship_substatus||"").toLowerCase() === "packed").forEach(o => {
  console.log(JSON.stringify({ order_id: o.order_id, sla: getSlaKey(o), full: isFulfillment(o), bucket: classify(o, today) }));
});

console.log("\n=== PEDIDOS COM SLA HOJE (" + today + ") ===");
fresh.filter(o => getSlaKey(o) === today).forEach(o => {
  console.log(JSON.stringify({ order_id: o.order_id, sub: o.ship_substatus, full: isFulfillment(o) }));
});

console.log("\n=== PEDIDOS READY_FOR_PICKUP ===");
fresh.filter(o => (o.ship_substatus||"").toLowerCase() === "ready_for_pickup").forEach(o => {
  console.log(JSON.stringify({ order_id: o.order_id }));
});

console.log("\n=== NULL (nao operacional) - TOP STATUSES ===");
const nullSt = {};
fresh.forEach(o => { if (!classify(o, today)) { const k = `${o.ship_status||o.order_status}/${o.ship_substatus||"none"}`; nullSt[k] = (nullSt[k]||0)+1; }});
Object.entries(nullSt).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Check shipped/none in detail - are some of these actually operational?
console.log("\n=== SHIPPED/NONE - SAMPLE (may be missing from dashboard) ===");
const shippedNone = fresh.filter(o => (o.ship_status||"").toLowerCase() === "shipped" && (o.ship_substatus||"none").toLowerCase() === "none");
console.log("Total shipped/none:", shippedNone.length);
shippedNone.slice(0, 5).forEach(o => {
  console.log(JSON.stringify({ order_id: o.order_id, sla: getSlaKey(o), sale: o.sale_date ? o.sale_date.substring(0,10) : null }));
});

// Check pending/buffered
console.log("\n=== PENDING ORDERS ===");
const pending = fresh.filter(o => (o.ship_status||o.order_status||"").toLowerCase() === "pending");
console.log("Total pending:", pending.length);

db.close();
