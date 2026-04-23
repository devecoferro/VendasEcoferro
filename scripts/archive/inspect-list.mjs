import Database from "better-sqlite3";
const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

const snap = db.prepare(`
  SELECT * FROM private_seller_center_snapshots
  WHERE store = 'all' AND selected_tab_label = 'Proximos dias'
  ORDER BY captured_at DESC LIMIT 1
`).get();

const raw = safeJson(snap.raw_payload);
console.log("raw.list:");
console.log(JSON.stringify(raw.list, null, 2).slice(0, 6000));
