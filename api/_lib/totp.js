// Helper de 2FA via TOTP (RFC 6238).
// Secret é criptografado em repouso com AES-256-GCM derivado de ML_CLIENT_SECRET
// (mesma técnica dos tokens ML — ver api/ml/_lib/storage.js).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { authenticator } from "otplib";

const ALGO = "aes-256-gcm";

function getKey() {
  const secret = process.env.ML_CLIENT_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain) {
  if (!plain) return null;
  const key = getKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  if (!stored.startsWith("enc:")) return stored;
  const key = getKey();
  if (!key) return stored;
  try {
    const [, ivHex, tagHex, ctHex] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");
    const dec = createDecipheriv(ALGO, key, iv);
    dec.setAuthTag(tag);
    return dec.update(ct) + dec.final("utf8");
  } catch {
    return stored;
  }
}

/**
 * Gera novo secret TOTP (base32) + URL pra QR code.
 * Retorna { secret, otpauthUrl }.
 */
export function generateTotpSecret(username, issuer = "EcoFerro Vendas") {
  const secret = authenticator.generateSecret(); // base32
  const otpauthUrl = authenticator.keyuri(username, issuer, secret);
  return { secret, otpauthUrl };
}

/**
 * Valida um código de 6 dígitos contra o secret. Tolera drift de ±1 step (30s).
 */
export function verifyTotpCode(secret, code) {
  if (!secret || !code) return false;
  try {
    // window=1 → aceita código atual + anterior + próximo
    authenticator.options = { window: 1 };
    return authenticator.verify({ token: String(code).replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

/**
 * Gera 10 backup codes (16 chars hex cada). Armazenados hashed (sha256) no DB.
 * Cada um pode ser usado 1x.
 */
export function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(8).toString("hex").toUpperCase());
  }
  return codes;
}

export function hashBackupCode(code) {
  return createHash("sha256")
    .update(String(code).trim().toUpperCase())
    .digest("hex");
}
