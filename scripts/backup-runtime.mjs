import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { DATA_DIR, DB_PATH, ensureDataDirectory } from "../api/_lib/app-config.js";

function now() {
  return new Date();
}

function buildTimestamp(date = now()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseRetentionDays(value, fallback = 14) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function copyDirectoryIfExists(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return {
      copied: false,
      path: sourcePath,
      files: 0,
      bytes: 0,
    };
  }

  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  const stats = collectDirectoryStats(destinationPath);
  return {
    copied: true,
    path: sourcePath,
    files: stats.files,
    bytes: stats.bytes,
  };
}

function collectDirectoryStats(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return { files: 0, bytes: 0 };
  }

  const queue = [directoryPath];
  let files = 0;
  let bytes = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
        continue;
      }

      if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(resolved).size;
      }
    }
  }

  return { files, bytes };
}

function removeDirectoryQuietly(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return;
  }

  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function pruneExpiredBackups(rootDir, retentionDays) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("ecoferro-")) {
      continue;
    }

    const resolved = path.join(rootDir, entry.name);
    const stats = fs.statSync(resolved);
    if (stats.mtimeMs >= cutoff) {
      continue;
    }

    fs.rmSync(resolved, { recursive: true, force: true });
    removed.push(resolved);
  }

  return removed;
}

function buildConfig() {
  const backupRoot =
    normalizeNullable(process.env.BACKUP_RUNTIME_DIR) ||
    path.join(DATA_DIR, "backups", "runtime");
  const mirrorDir = normalizeNullable(process.env.BACKUP_MIRROR_DIR);

  return {
    backupRoot: path.resolve(backupRoot),
    mirrorDir: mirrorDir ? path.resolve(mirrorDir) : null,
    retentionDays: parseRetentionDays(process.env.BACKUP_RETENTION_DAYS, 14),
    includePlaywrightState: parseBoolean(
      process.env.BACKUP_INCLUDE_PLAYWRIGHT_STATE,
      false
    ),
  };
}

async function main() {
  ensureDataDirectory();

  const config = buildConfig();
  ensureDirectory(config.backupRoot);

  const timestamp = buildTimestamp();
  const backupName = `ecoferro-${timestamp}`;
  const tempDir = path.join(config.backupRoot, `.tmp-${backupName}`);
  const finalDir = path.join(config.backupRoot, backupName);
  const metadataDir = path.join(tempDir, "metadata");
  const dbDir = path.join(tempDir, "db");
  const documentsDir = path.join(tempDir, "documents");
  const playwrightDir = path.join(tempDir, "playwright");

  removeDirectoryQuietly(tempDir);
  ensureDirectory(metadataDir);
  ensureDirectory(dbDir);

  const dbBackupPath = path.join(dbDir, "ecoferro.db");
  const database = new Database(DB_PATH);

  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
    await database.backup(dbBackupPath);
  } finally {
    database.close();
  }

  const documentsSource = path.join(DATA_DIR, "documents");
  const documentsCopy = copyDirectoryIfExists(documentsSource, documentsDir);
  const playwrightSource = path.join(DATA_DIR, "playwright");
  const playwrightCopy = config.includePlaywrightState
    ? copyDirectoryIfExists(playwrightSource, playwrightDir)
    : {
        copied: false,
        path: playwrightSource,
        files: 0,
        bytes: 0,
        skipped: true,
      };

  const manifest = {
    backup_name: backupName,
    created_at: new Date().toISOString(),
    source: {
      data_dir: DATA_DIR,
      db_path: DB_PATH,
    },
    contents: {
      db: {
        storage_path: path.join(finalDir, "db", "ecoferro.db"),
        bytes: fs.statSync(dbBackupPath).size,
      },
      documents: documentsCopy,
      playwright_state: playwrightCopy,
    },
    restore: {
      command_preview: `node scripts/restore-runtime-backup.mjs \"${finalDir}\" --target-data-dir \"${DATA_DIR}\"`,
      notes: [
        "Pare a aplicacao antes da restauracao real.",
        "O restore repoe banco e documentos a partir do snapshot escolhido.",
        "Storage state do Playwright so e restaurado se existir no backup.",
      ],
    },
  };

  writeJson(path.join(metadataDir, "manifest.json"), manifest);
  fs.renameSync(tempDir, finalDir);

  let mirroredTo = null;
  if (config.mirrorDir) {
    ensureDirectory(config.mirrorDir);
    const mirrorTarget = path.join(config.mirrorDir, backupName);
    removeDirectoryQuietly(mirrorTarget);
    fs.cpSync(finalDir, mirrorTarget, { recursive: true, force: true });
    mirroredTo = mirrorTarget;
  }

  const removedLocal = pruneExpiredBackups(config.backupRoot, config.retentionDays);
  const removedMirror =
    config.mirrorDir != null
      ? pruneExpiredBackups(config.mirrorDir, config.retentionDays)
      : [];

  const summary = {
    status: "ok",
    backup_dir: finalDir,
    mirror_dir: mirroredTo,
    retention_days: config.retentionDays,
    removed_local: removedLocal,
    removed_mirror: removedMirror,
    manifest,
  };

  writeJson(path.join(config.backupRoot, "latest.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
