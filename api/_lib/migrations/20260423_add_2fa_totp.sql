-- S9: 2FA TOTP (RFC 6238) opcional. Admin pode habilitar via tela de perfil.
-- Secret é criptografado (mesma técnica do ML access_token — hex'AES-256-GCM').
-- Se 2FA estiver habilitado, o login exige código de 6 dígitos após senha.

ALTER TABLE app_user_profiles ADD COLUMN totp_secret TEXT;
ALTER TABLE app_user_profiles ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_user_profiles ADD COLUMN totp_backup_codes TEXT;
-- Último login com 2FA OK (epoch ms) — usado pra mostrar "último login"
ALTER TABLE app_user_profiles ADD COLUMN totp_last_used_at TEXT;
