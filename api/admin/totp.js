// Endpoints TOTP 2FA:
//   POST /api/admin/totp/enroll-start    (admin) → retorna secret + QR URL
//   POST /api/admin/totp/enroll-confirm  (admin) → confirma com código, ativa
//   POST /api/admin/totp/disable         (admin) → desativa 2FA do próprio admin
//
// Admin-only por design: se um dia abrir 2FA pra usuários normais,
// replicar lógica num endpoint /api/profile/totp/* separado.

import { requireAdmin } from "../_lib/auth-server.js";
import { db } from "../_lib/db.js";
import {
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotpCode,
} from "../_lib/totp.js";
import { recordAuditLog } from "../_lib/audit-log.js";

export default async function handler(req, res) {
  let profile;
  try {
    const result = await requireAdmin(req);
    profile = result.profile;
    req.profile = profile;
  } catch (error) {
    const status = error?.statusCode || 401;
    return res.status(status).json({ error: error?.message || "Acesso negado." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const rawPath = String(req.path || req.url || "");
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

  // Sub-path dispatch
  if (/\/enroll-start(\?|$)/.test(rawPath)) {
    return handleEnrollStart(req, res, profile);
  }
  if (/\/enroll-confirm(\?|$)/.test(rawPath)) {
    return handleEnrollConfirm(req, res, profile, body);
  }
  if (/\/disable(\?|$)/.test(rawPath)) {
    return handleDisable(req, res, profile, body);
  }

  return res.status(404).json({
    error: "Rota não encontrada. Use /enroll-start, /enroll-confirm ou /disable.",
  });
}

function handleEnrollStart(req, res, profile) {
  const { secret, otpauthUrl } = generateTotpSecret(profile.username);
  // Armazena SEM marcar como enabled — só vira enabled no confirm
  db.prepare(
    `UPDATE app_user_profiles SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`
  ).run(encryptSecret(secret), profile.id);

  recordAuditLog({
    req,
    action: "totp.enroll_start",
    targetType: "app_user_profile",
    targetId: profile.id,
  });

  return res.json({
    success: true,
    secret, // plaintext só aqui — cliente precisa pra QR code
    otpauth_url: otpauthUrl,
    message: "Escaneie o QR code no seu app TOTP (Google Authenticator, Authy, etc) e envie o código de 6 dígitos pra confirmar.",
  });
}

function handleEnrollConfirm(req, res, profile, body) {
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Código inválido — deve ser 6 dígitos." });
  }

  const row = db
    .prepare(`SELECT totp_secret FROM app_user_profiles WHERE id = ?`)
    .get(profile.id);
  const secret = decryptSecret(row?.totp_secret);
  if (!secret) {
    return res.status(400).json({
      error: "Enrollment não iniciado. Chame /enroll-start primeiro.",
    });
  }

  if (!verifyTotpCode(secret, code)) {
    return res.status(400).json({ error: "Código TOTP inválido." });
  }

  // Confirmado — ativa 2FA + gera backup codes
  const backupCodes = generateBackupCodes(10);
  const hashed = backupCodes.map(hashBackupCode);

  db.prepare(
    `UPDATE app_user_profiles
     SET totp_enabled = 1, totp_backup_codes = ?, totp_last_used_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(hashed), new Date().toISOString(), profile.id);

  recordAuditLog({
    req,
    action: "totp.enrolled",
    targetType: "app_user_profile",
    targetId: profile.id,
  });

  return res.json({
    success: true,
    backup_codes: backupCodes,
    message:
      "2FA ativado! GUARDE estes 10 códigos de backup em local seguro — cada um funciona 1x se perder o acesso ao app TOTP.",
  });
}

function handleDisable(req, res, profile, body) {
  const code = String(body.code || "").trim();
  const row = db
    .prepare(`SELECT totp_secret, totp_enabled FROM app_user_profiles WHERE id = ?`)
    .get(profile.id);
  if (!row?.totp_enabled) {
    return res.status(400).json({ error: "2FA não está ativo." });
  }

  // Exige código pra prevenir adversário com sessão roubada desativar 2FA
  const secret = decryptSecret(row.totp_secret);
  if (!verifyTotpCode(secret, code)) {
    return res.status(400).json({ error: "Código TOTP inválido." });
  }

  db.prepare(
    `UPDATE app_user_profiles
     SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL
     WHERE id = ?`
  ).run(profile.id);

  recordAuditLog({
    req,
    action: "totp.disabled",
    targetType: "app_user_profile",
    targetId: profile.id,
  });

  return res.json({ success: true, message: "2FA desativado." });
}
