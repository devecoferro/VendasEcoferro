import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, DATA_DIR, ensureDataDirectory } from "../api/_lib/app-config.js";

function buildTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function main() {
  ensureDataDirectory();
  const backupsDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  const backupFile = path.join(backupsDir, `ecoferro-${buildTimestamp()}.db`);
  const database = new Database(DB_PATH);

  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
    await database.backup(backupFile);
    console.log(`Backup criado em ${backupFile}`);
  } finally {
    database.close();
  }
}

await main();

