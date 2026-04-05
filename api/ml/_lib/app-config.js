import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, "ecoferro.db");

export const APP_PORT = Number(process.env.PORT || 3000);
export const APP_BASE_URL =
  process.env.APP_BASE_URL || `http://localhost:${APP_PORT}`;

export const ML_CLIENT_ID = process.env.ML_CLIENT_ID || "";
export const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || "";

export function ensureMercadoLivreCredentials() {
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
    throw new Error(
      "ML_CLIENT_ID e ML_CLIENT_SECRET precisam estar configurados na VPS."
    );
  }
}
