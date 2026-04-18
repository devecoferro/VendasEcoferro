import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const defaultDataDir = path.join(projectRoot, "data");

export const APP_PORT = Number(process.env.PORT || 3000);
export const APP_HOST = String(process.env.HOST || "0.0.0.0");
export const APP_BASE_URL = String(
  process.env.APP_BASE_URL || `http://127.0.0.1:${APP_PORT}`
).trim();
export const DATA_DIR = path.resolve(process.env.DATA_DIR || defaultDataDir);
export const DB_PATH = path.resolve(DATA_DIR, "ecoferro.db");

export const ML_CLIENT_ID = String(process.env.ML_CLIENT_ID || "").trim();
export const ML_CLIENT_SECRET = String(process.env.ML_CLIENT_SECRET || "").trim();

export const APP_DEFAULT_ADMIN_USERNAME = String(
  process.env.APP_DEFAULT_ADMIN_USERNAME || ""
).trim();
export const APP_DEFAULT_ADMIN_PASSWORD = String(
  process.env.APP_DEFAULT_ADMIN_PASSWORD || ""
).trim();
export const APP_SESSION_COOKIE_NAME = String(
  process.env.APP_SESSION_COOKIE_NAME || "ecoferro_session"
).trim();
export const APP_SESSION_TTL_DAYS = Math.max(
  1,
  Number.parseInt(process.env.APP_SESSION_TTL_DAYS || "7", 10) || 7
);

export function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });
}

export function ensureMercadoLivreCredentials() {
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
    throw new Error("Credenciais do Mercado Livre nao configuradas na VPS.");
  }
}

/**
 * I-M5: Valida env vars CRÍTICAS no boot. Fail fast com mensagem clara
 * em vez de deixar o sync falhar 1 hora depois sem diagnóstico.
 * I-M6: Rejeita placeholders ("DEFINA_...") vazados de .env.example.
 */
const PLACEHOLDER_PREFIXES = ["DEFINA_", "SEU_", "<", "TROQUE"];
function isPlaceholder(value) {
  if (!value) return true;
  const upper = String(value).toUpperCase();
  return PLACEHOLDER_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

export function validateRequiredEnv() {
  const errors = [];
  const required = {
    ML_CLIENT_ID,
    ML_CLIENT_SECRET,
    APP_DEFAULT_ADMIN_USERNAME,
    APP_DEFAULT_ADMIN_PASSWORD,
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      errors.push(`${key} não configurada`);
    } else if (isPlaceholder(value)) {
      errors.push(`${key} contém placeholder (${String(value).slice(0, 10)}…) — defina um valor real`);
    }
  }
  if (String(APP_DEFAULT_ADMIN_PASSWORD || "").length < 8) {
    errors.push("APP_DEFAULT_ADMIN_PASSWORD deve ter no mínimo 8 caracteres");
  }
  if (errors.length > 0) {
    console.error("\n[config] Validação de env vars falhou:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    throw new Error(`Configuração inválida: ${errors.length} problema(s)`);
  }
}

ensureDataDirectory();

