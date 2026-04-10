import fs from "node:fs";
import path from "node:path";

import {
  APP_DEFAULT_ADMIN_PASSWORD,
  APP_DEFAULT_ADMIN_USERNAME,
} from "../../api/_lib/app-config.js";

const projectRoot = process.cwd();
const secretsDir = path.join(projectRoot, "data", "secrets");
const latestRotationPath = path.join(secretsDir, "ecoferro-admin-latest.json");

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function resolveAdminCredentials() {
  const envUsername =
    normalizeNullable(process.env.ECOFERRO_ADMIN_USERNAME) ||
    normalizeNullable(process.env.ECOFERRO_CAPTURE_USERNAME);
  const envPassword =
    normalizeNullable(process.env.ECOFERRO_ADMIN_PASSWORD) ||
    normalizeNullable(process.env.ECOFERRO_CAPTURE_PASSWORD);

  if (envUsername && envPassword) {
    return {
      username: envUsername,
      password: envPassword,
      source: "environment",
    };
  }

  const latestRotation = readJsonFile(latestRotationPath);
  if (
    normalizeNullable(latestRotation?.username) &&
    normalizeNullable(latestRotation?.password)
  ) {
    return {
      username: normalizeNullable(latestRotation.username),
      password: normalizeNullable(latestRotation.password),
      source: latestRotation.path ? "rotation_file" : "rotation_cache",
      rotated_at: normalizeNullable(latestRotation.rotated_at),
      path: normalizeNullable(latestRotation.path),
    };
  }

  return {
    username: APP_DEFAULT_ADMIN_USERNAME,
    password: APP_DEFAULT_ADMIN_PASSWORD,
    source: "app_defaults",
  };
}

export function persistRotatedAdminCredentials({
  username,
  password,
  rotated_at,
  base_url,
}) {
  const safeUsername = normalizeNullable(username);
  const safePassword = normalizeNullable(password);

  if (!safeUsername || !safePassword) {
    throw new Error("Credenciais insuficientes para persistir a rotacao do admin.");
  }

  fs.mkdirSync(secretsDir, { recursive: true });

  const timestamp = String(rotated_at || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const rotationPath = path.join(secretsDir, `ecoferro-admin-${timestamp}.json`);
  const payload = {
    username: safeUsername,
    password: safePassword,
    rotated_at: normalizeNullable(rotated_at) || new Date().toISOString(),
    base_url: normalizeNullable(base_url) || null,
  };

  fs.writeFileSync(rotationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    latestRotationPath,
    `${JSON.stringify({ ...payload, path: rotationPath }, null, 2)}\n`,
    "utf8"
  );
  for (const filePath of [rotationPath, latestRotationPath]) {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best-effort only; some environments ignore POSIX modes.
    }
  }

  return {
    rotationPath,
    latestRotationPath,
  };
}
