// Engenharia reversa ML — cruza snapshot do scraper (ML Seller Center)
// com nossa ml_orders pra descobrir o mapping REAL
//   (ship_status, ship_substatus, logistic_type) -> bucket ML
//
// Output: relatorio markdown que vai ficar em docs/ml-classification-reference.md
import Database from "better-sqlite3";
import fs from "node:fs";

const DB = process.env.DB_PATH || "/app/data/ecoferro.db";
const db = new Database(DB, { readonly: true });

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

console.log("=== Tabelas relevantes ===");
const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND (name LIKE '%snapshot%' OR name LIKE '%scraper%' OR name LIKE '%seller_center%' OR name LIKE '%live%')
`).all();
for (const t of tables) {
  const c = db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get();
  console.log(`  ${t.name}: ${c.n} rows`);
}

// Tenta achar tabela de snapshots do scraper
let snapshotRow = null;
for (const tableName of ["private_seller_center_snapshots", "ml_private_seller_center_snapshots", "ml_live_snapshots", "ml_seller_center_snapshots"]) {
  try {
    const r = db.prepare(`SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT 1`).get();
    if (r) {
      snapshotRow = { table: tableName, ...r };
      break;
    }
  } catch { /* tabela nao existe */ }
}

if (!snapshotRow) {
  console.log("\n(sem snapshot do scraper no DB — pulando cross-reference)");
  process.exit(0);
}

console.log(`\n=== Snapshot mais recente: ${snapshotRow.table} ===`);
const keys = Object.keys(snapshotRow).filter(k => k !== "table" && typeof snapshotRow[k] === "string" && snapshotRow[k].length < 500);
for (const k of keys) console.log(`  ${k}: ${String(snapshotRow[k]).slice(0, 200)}`);

// Procura o campo que tem o JSON grande (snapshot_json, payload, data, etc)
let snapshotData = null;
for (const candidate of ["snapshot_json", "data", "payload", "snapshot", "content", "raw_data"]) {
  if (snapshotRow[candidate]) {
    snapshotData = safeJson(snapshotRow[candidate]);
    if (snapshotData) {
      console.log(`\n=== Dados do snapshot (campo: ${candidate}) ===`);
      break;
    }
  }
}

if (!snapshotData) {
  // Talvez os dados estejam em multiplas linhas — vou listar os campos
  const cols = db.prepare(`PRAGMA table_info(${snapshotRow.table})`).all();
  console.log("\nColunas:", cols.map(c => c.name).join(", "));
  process.exit(0);
}

console.log("Top-level keys:", Object.keys(snapshotData).slice(0, 20).join(", "));

// Se tiver orders/entries com tab + order_id, cruza com nossa ml_orders
let entries = [];
if (Array.isArray(snapshotData.orders)) entries = snapshotData.orders;
else if (Array.isArray(snapshotData.entries)) entries = snapshotData.entries;
else if (snapshotData.by_tab) {
  for (const [tab, arr] of Object.entries(snapshotData.by_tab)) {
    if (!Array.isArray(arr)) continue;
    for (const o of arr) entries.push({ ...o, _tab: tab });
  }
}

console.log(`\nTotal entries no snapshot: ${entries.length}`);
if (entries.length === 0) {
  console.log("Snapshot format desconhecido — dump primeiros keys:");
  console.log(JSON.stringify(snapshotData, null, 2).slice(0, 2000));
  process.exit(0);
}

console.log("\nPrimeiro entry:", JSON.stringify(entries[0], null, 2).slice(0, 1000));

// Mapping observado: (ss|sss|lt) -> Set(tab)
const mapping = new Map();
const getOrderRaw = db.prepare(`SELECT raw_data FROM ml_orders WHERE order_id = ? LIMIT 1`);

let matched = 0;
for (const e of entries) {
  const orderId = String(e.order_id || e.id || e.orderId || "");
  if (!orderId) continue;
  const row = getOrderRaw.get(orderId);
  if (!row) continue;
  matched++;
  const raw = safeJson(row.raw_data);
  if (!raw) continue;
  const ss = String(raw.shipment_snapshot?.status || "-");
  const sss = String(raw.shipment_snapshot?.substatus || "-");
  const lt = String(raw.shipment_snapshot?.logistic_type || "-");
  const os = String(raw.status || "-");
  const tab = String(e._tab || e.tab || e.bucket || e.section || "?");
  const key = `${ss} | ${sss} | ${lt} | ${os}`;
  if (!mapping.has(key)) mapping.set(key, new Map());
  const inner = mapping.get(key);
  inner.set(tab, (inner.get(tab) || 0) + 1);
}

console.log(`\nMatched: ${matched}/${entries.length}`);
console.log("\n=== MAPPING OBSERVADO: (ss|sss|lt|os) -> ML tab counts ===");
for (const [k, tabs] of [...mapping.entries()].sort()) {
  const parts = [...tabs.entries()].map(([t, n]) => `${t}:${n}`).join(", ");
  console.log(`  ${k}  ->  ${parts}`);
}
