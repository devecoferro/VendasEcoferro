// Procura dados do live-snapshot (scraper leve)
import Database from "better-sqlite3";
const db = new Database(process.env.DB_PATH || "/app/data/ecoferro.db", { readonly: true });

// Lista todas as tabelas pra achar onde o live-snapshot cacheia
const tabs = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tabelas com 'live' ou 'snapshot':");
for (const t of tabs) {
  if (t.name.includes("live") || t.name.includes("snapshot") || t.name.includes("scraper")) {
    const c = db.prepare(`SELECT COUNT(*) as n FROM ${t.name}`).get();
    console.log(`  ${t.name}: ${c.n} rows`);
  }
}

// Procura qualquer tabela com algo tipo seller_center
console.log("\nTabelas com 'seller':");
for (const t of tabs) {
  if (t.name.includes("seller")) {
    const c = db.prepare(`SELECT COUNT(*) as n FROM ${t.name}`).get();
    console.log(`  ${t.name}: ${c.n} rows`);
  }
}

// Verifica se existe ml_live_snapshot via filesystem (arquivo)
import fs from "node:fs";
import path from "node:path";
const dataDir = "/app/data";
console.log("\nArquivos em /app/data:");
try {
  const files = fs.readdirSync(dataDir);
  for (const f of files.slice(0, 20)) {
    const stat = fs.statSync(path.join(dataDir, f));
    console.log(`  ${f} (${stat.isDirectory() ? 'dir' : stat.size + ' bytes'})`);
  }
} catch (e) {
  console.log("  erro:", e.message);
}
