// Backup automatico do SQLite usando a API nativa .backup() do better-sqlite3.
// Roda a cada 6 horas em producao. Mantem os ultimos 5 backups.

import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { DATA_DIR } from "./app-config.js";
import createLogger from "./logger.js";

const log = createLogger("backup");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas
let backupTimer = null;

function formatTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function cleanOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("ecoferro_") && f.endsWith(".db"))
      .sort()
      .reverse();

    // Remove backups alem do limite
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      const filePath = path.join(BACKUP_DIR, files[i]);
      fs.unlinkSync(filePath);
      log.info("Backup antigo removido", { file: files[i] });
    }
  } catch (error) {
    log.error("Erro ao limpar backups antigos", error);
  }
}

export async function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const filename = `ecoferro_${formatTimestamp()}.db`;
    const backupPath = path.join(BACKUP_DIR, filename);

    // better-sqlite3 .backup() retorna uma Promise — aguarda conclusao
    await db.backup(backupPath);

    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

    // I-H2: integrity check no arquivo gerado. Se backup ficou corrompido,
    // deleta pra não rotacionar backups bons. Retry manual na próxima janela.
    try {
      const BetterSqlite3 = (await import("better-sqlite3")).default;
      const verifyDb = new BetterSqlite3(backupPath, { readonly: true });
      try {
        const check = verifyDb.pragma("integrity_check", { simple: true });
        if (check !== "ok") {
          throw new Error(`integrity_check retornou: ${check}`);
        }
      } finally {
        verifyDb.close();
      }
    } catch (verifyError) {
      log.error("Backup corrompido — removendo", verifyError);
      try { fs.unlinkSync(backupPath); } catch {}
      throw new Error(`Backup falhou no integrity_check: ${verifyError.message || verifyError}`);
    }

    log.info("Backup concluido (integrity_check=ok)", { file: filename, size_mb: sizeMB });

    cleanOldBackups();

    return { success: true, file: filename, size_mb: sizeMB };
  } catch (error) {
    log.error("Falha no backup", error);
    return { success: false, error: error.message };
  }
}

export function startAutoBackup() {
  if (backupTimer) return;

  log.info("Auto-backup iniciado", { interval_hours: BACKUP_INTERVAL_MS / 3600000 });

  // Primeiro backup 1 minuto apos o boot
  setTimeout(async () => {
    await runBackup();
    backupTimer = setInterval(async () => {
      await runBackup();
    }, BACKUP_INTERVAL_MS);
  }, 60_000);
}

export function stopAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
