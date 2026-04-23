// Inspeciona a estrutura exata do raw_payload do scraper
import Database from "better-sqlite3";
const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Pega uma snapshot "all" + "Proximos dias" como exemplo
const snap = db.prepare(`
  SELECT * FROM private_seller_center_snapshots
  WHERE store = 'all' AND selected_tab_label = 'Proximos dias'
  ORDER BY captured_at DESC LIMIT 1
`).get();

if (!snap) {
  console.log("nenhuma snapshot 'all/Proximos dias' encontrada");
  process.exit(0);
}

console.log("snapshot:", snap.captured_at, "tab counts:", {
  today: snap.tab_today_count,
  next: snap.tab_next_days_count,
  transit: snap.tab_in_the_way_count,
  finished: snap.tab_finished_count,
});

const raw = safeJson(snap.raw_payload);
const cards = safeJson(snap.cards_payload);
console.log("\nraw keys:", Object.keys(raw || {}));
console.log("cards keys:", Object.keys(cards || {}));

console.log("\nraw.list type:", typeof raw?.list, Array.isArray(raw?.list) ? "(array)" : "");
if (raw?.list) {
  console.log("raw.list keys:", Object.keys(raw.list).slice(0, 20));
  console.log("raw.list sample (first 4000 chars):", JSON.stringify(raw.list, null, 2).slice(0, 4000));
}

console.log("\nraw.tabs:", JSON.stringify(raw?.tabs, null, 2).slice(0, 1500));
console.log("\nraw.dashboard keys:", Object.keys(raw?.dashboard || {}).slice(0, 10));

if (cards) {
  for (const [k, v] of Object.entries(cards)) {
    console.log(`\ncards[${k}] keys:`, Object.keys(v || {}).slice(0, 10));
    console.log(`cards[${k}] sample:`, JSON.stringify(v, null, 2).slice(0, 1000));
  }
}
