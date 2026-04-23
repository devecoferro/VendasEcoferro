// Engenharia reversa v2 — le private_seller_center_snapshots e
// cruza com ml_orders pra extrair mapping REAL (ss,sss,lt,os) -> tab ML
import Database from "better-sqlite3";

const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// Pega a snapshot mais recente de cada combinação (store, tab)
const snaps = db.prepare(`
  SELECT s.*
  FROM private_seller_center_snapshots s
  INNER JOIN (
    SELECT store, selected_tab, MAX(captured_at) AS max_captured
    FROM private_seller_center_snapshots
    GROUP BY store, selected_tab
  ) m ON m.store = s.store AND m.selected_tab = s.selected_tab AND m.max_captured = s.captured_at
  ORDER BY s.captured_at DESC
`).all();

console.log(`Snapshots encontradas: ${snaps.length}`);
for (const s of snaps) {
  console.log(`  ${s.store} / ${s.selected_tab_label} (${s.captured_at.slice(0, 10)})`);
  console.log(`    today=${s.tab_today_count} next=${s.tab_next_days_count} transit=${s.tab_in_the_way_count} finished=${s.tab_finished_count}`);
}

const getOrderRaw = db.prepare(`SELECT raw_data FROM ml_orders WHERE order_id = ? LIMIT 1`);

const mapping = new Map(); // (ss|sss|lt|os) -> Map(tab -> count)
let totalOrdersInSnapshots = 0;
let matched = 0;

for (const snap of snaps) {
  const cards = safeJson(snap.cards_payload) || {};
  const raw = safeJson(snap.raw_payload) || {};
  const tab = snap.selected_tab_label; // "Envios de hoje", "Próximos dias", etc

  // Explora a estrutura — raw.list geralmente e o array principal
  let orders = [];
  if (Array.isArray(raw.list)) orders = raw.list;
  else if (Array.isArray(raw.list?.items)) orders = raw.list.items;
  else if (Array.isArray(raw.list?.orders)) orders = raw.list.orders;
  else if (typeof raw.list === "object") {
    // list pode ter chaves numericas (0, 1, 2) que apontam pra pedidos
    const vals = Object.values(raw.list).filter((v) => v && typeof v === "object");
    if (vals.length > 0) orders = vals;
  }
  if (orders.length === 0 && cards) {
    // Cards numerados 0/1/2 apontam pra cada card na UI, pode ter items
    for (const c of Object.values(cards)) {
      if (c && Array.isArray(c.items)) orders.push(...c.items);
      else if (c && Array.isArray(c.orders)) orders.push(...c.orders);
    }
  }

  if (orders.length === 0) {
    console.log(`    [${snap.store}/${snap.selected_tab_label}] raw.list type: ${typeof raw.list}`);
    if (raw.list && typeof raw.list === "object") {
      console.log(`      list keys: ${Object.keys(raw.list).slice(0, 10).join(", ")}`);
      console.log(`      first val: ${JSON.stringify(Object.values(raw.list)[0]).slice(0, 300)}`);
    }
    continue;
  }
  totalOrdersInSnapshots += orders.length;

  for (const o of orders) {
    const orderId = String(o.order_id || o.orderId || o.id || o.pack_id || "");
    if (!orderId) continue;
    const row = getOrderRaw.get(orderId);
    if (!row) continue;
    matched++;
    const rd = safeJson(row.raw_data);
    if (!rd) continue;
    const ss = String(rd.shipment_snapshot?.status || "-");
    const sss = String(rd.shipment_snapshot?.substatus || "-");
    const lt = String(rd.shipment_snapshot?.logistic_type || "-");
    const os = String(rd.status || "-");
    const key = `${ss} | ${sss} | ${lt} | ${os}`;
    if (!mapping.has(key)) mapping.set(key, new Map());
    const inner = mapping.get(key);
    inner.set(tab, (inner.get(tab) || 0) + 1);
  }
}

console.log(`\nOrders no snapshot total: ${totalOrdersInSnapshots}`);
console.log(`Matched com nossa base: ${matched}`);
console.log();
console.log("=== MAPPING OBSERVADO: (ss | sss | lt | os) -> tab ML ===");
for (const [k, tabs] of [...mapping.entries()].sort()) {
  const parts = [...tabs.entries()].map(([t, n]) => `${t}:${n}`).join(", ");
  console.log(`  ${k}  ->  ${parts}`);
}
