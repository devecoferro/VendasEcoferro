import fs from "node:fs";
import path from "node:path";

import {
  APP_BASE_URL,
  APP_DEFAULT_ADMIN_PASSWORD,
  APP_DEFAULT_ADMIN_USERNAME,
  APP_SESSION_COOKIE_NAME,
  DATA_DIR,
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
} from "../api/_lib/app-config.js";
import { getProfileByUsername, verifyPassword } from "../api/_lib/auth-server.js";

const DEFAULT_PASSWORD = "Ecoferro@2026";

function risk(id, severity, message, details = null) {
  return {
    id,
    severity,
    message,
    details,
  };
}

function safeStat(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.statSync(filePath);
}

function main() {
  const risks = [];
  const warnings = [];
  const info = [];

  if (!APP_BASE_URL.startsWith("https://")) {
    risks.push(
      risk(
        "app_base_url_not_https",
        "high",
        "APP_BASE_URL nao usa HTTPS. O cookie de sessao nao ficara protegido com Secure.",
        { app_base_url: APP_BASE_URL }
      )
    );
  } else {
    info.push({ id: "app_base_url_https", value: APP_BASE_URL });
  }

  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
    risks.push(
      risk(
        "mercado_livre_credentials_missing",
        "high",
        "Credenciais do Mercado Livre nao estao configuradas no ambiente.",
        null
      )
    );
  } else {
    info.push({
      id: "mercado_livre_credentials",
      value: {
        client_id_configured: true,
        client_secret_configured: true,
      },
    });
  }

  const adminProfile = getProfileByUsername(null, APP_DEFAULT_ADMIN_USERNAME);
  const defaultPasswordStillWorks =
    adminProfile?.password_hash && verifyPassword(DEFAULT_PASSWORD, adminProfile.password_hash);

  if (defaultPasswordStillWorks) {
    risks.push(
      risk(
        "default_admin_password",
        "critical",
        "A senha padrao ainda autentica o usuario admin ativo.",
        { username: APP_DEFAULT_ADMIN_USERNAME }
      )
    );
  } else {
    info.push({
      id: "default_admin_password_rotated",
      value: { username: APP_DEFAULT_ADMIN_USERNAME },
    });
  }

  if (APP_DEFAULT_ADMIN_PASSWORD === DEFAULT_PASSWORD) {
    warnings.push(
      risk(
        "default_admin_password_env_fallback",
        "medium",
        "O fallback APP_DEFAULT_ADMIN_PASSWORD do ambiente continua no valor padrao. Se o usuario admin for recriado, a senha padrao voltara a existir.",
        { username: APP_DEFAULT_ADMIN_USERNAME }
      )
    );
  } else {
    info.push({
      id: "default_admin_password_env_overridden",
      value: { username: APP_DEFAULT_ADMIN_USERNAME },
    });
  }

  const playwrightStorageStatePath = path.join(
    DATA_DIR,
    "playwright",
    "private-seller-center.storage-state.json"
  );
  const playwrightStorageStat = safeStat(playwrightStorageStatePath);
  if (playwrightStorageStat) {
    warnings.push(
      risk(
        "playwright_storage_state_present",
        "medium",
        "Existe storage state local do Seller Center. Trate o arquivo como credencial operacional sensivel.",
        {
          path: playwrightStorageStatePath,
          last_modified_at: playwrightStorageStat.mtime.toISOString(),
          size_bytes: playwrightStorageStat.size,
        }
      )
    );
  }

  const documentsDir = path.join(DATA_DIR, "documents");
  const backupsDir = path.join(DATA_DIR, "backups");
  info.push({
    id: "session_cookie",
    value: APP_SESSION_COOKIE_NAME,
  });
  info.push({
    id: "storage_layout",
    value: {
      data_dir: DATA_DIR,
      documents_dir: documentsDir,
      backups_dir: backupsDir,
    },
  });

  const summary = {
    status: risks.some((entry) => entry.severity === "critical") ? "attention" : "ok",
    generated_at: new Date().toISOString(),
    risks,
    warnings,
    info,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
