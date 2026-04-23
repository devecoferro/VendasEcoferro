// Helper de 2FA via TOTP (RFC 6238).
// Secret é criptografado em repouso com AES-256-GCM derivado de ML_CLIENT_SECRET
// (mesma técnica dos tokens ML — ver api/ml/_lib/storage.js).
//
// Implementação TOTP inline (RFC 6238, RFC 4648 base32) pra evitar dep externa
// com issues de ESM exports. ~60 linhas de código, spec clara.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

// ─── Base32 (RFC 4648) ────────────────────────────────────────────────
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return output;
}

function base32Decode(str) {
  const cleaned = String(str || "").toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const c of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`Base32 char invalid: ${c}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─── TOTP (RFC 6238) ──────────────────────────────────────────────────
function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function totp(secretBase32, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  return hotp(base32Decode(secretBase32), counter);
}

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
 * Gera novo secret TOTP (base32, 20 bytes = 160 bits) + URL pra QR code.
 * Retorna { secret, otpauthUrl }.
 */
export function generateTotpSecret(username, issuer = "EcoFerro Vendas") {
  const secret = base32Encode(randomBytes(20));
  const encodedUser = encodeURIComponent(username);
  const encodedIssuer = encodeURIComponent(issuer);
  const otpauthUrl = `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauthUrl };
}

/**
 * Valida um código de 6 dígitos contra o secret. Tolera drift de ±1 step (30s).
 * Window = 1: aceita código atual + anterior + próximo.
 */
export function verifyTotpCode(secret, code) {
  if (!secret || !code) return false;
  const cleaned = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const now = Date.now();
    for (const delta of [-30_000, 0, 30_000]) {
      if (totp(secret, now + delta) === cleaned) return true;
    }
    return false;
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
