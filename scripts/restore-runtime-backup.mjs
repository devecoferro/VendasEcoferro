import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "../api/_lib/app-config.js";

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveArgValue(flag) {
  const index = process.argv.findIndex((entry) => entry === flag);
  if (index === -1) {
    return null;
  }

  return normalizeNullable(process.argv[index + 1]);
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function copyIfExists(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  return true;
}

function main() {
  const backupDir = path.resolve(normalizeNullable(process.argv[2]) || "");
  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error("Informe o diretorio de backup valido a ser restaurado.");
  }

  const confirm = process.argv.includes("--confirm");
  const targetDataDir = path.resolve(
    resolveArgValue("--target-data-dir") || DATA_DIR
  );

  const manifestPath = path.join(backupDir, "metadata", "manifest.json");
  const dbSource = path.join(backupDir, "db", "ecoferro.db");
  const documentsSource = path.join(backupDir, "documents");
  const playwrightSource = path.join(backupDir, "playwright");

  if (!fs.existsSync(manifestPath) || !fs.existsSync(dbSource)) {
    throw new Error("Backup invalido: manifest ou banco nao encontrado.");
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const targetDbPath = path.join(targetDataDir, "ecoferro.db");
  const targetDocumentsDir = path.join(targetDataDir, "documents");
  const targetPlaywrightDir = path.join(targetDataDir, "playwright");

  const preview = {
    status: confirm ? "ready_to_restore" : "dry_run",
    backup_dir: backupDir,
    target_data_dir: targetDataDir,
    will_restore: {
      db: dbSource,
      documents: fs.existsSync(documentsSource) ? documentsSource : null,
      playwright_state: fs.existsSync(playwrightSource) ? playwrightSource : null,
    },
    notes: [
      "Pare a aplicacao antes de rodar a restauracao real.",
      "O restore substitui ecoferro.db e a pasta documents no DATA_DIR alvo.",
      "Use --confirm apenas quando o servico estiver parado e o backup for o desejado.",
    ],
    manifest,
  };

  if (!confirm) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  ensureDirectory(targetDataDir);
  fs.copyFileSync(dbSource, targetDbPath);
  if (fs.existsSync(documentsSource)) {
    copyIfExists(documentsSource, targetDocumentsDir);
  }
  if (fs.existsSync(playwrightSource)) {
    copyIfExists(playwrightSource, targetPlaywrightDir);
  }

  console.log(
    JSON.stringify(
      {
        ...preview,
        status: "restored",
        restored_at: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

main();
