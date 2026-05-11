-- Migration: 20260511_add_tenant_settings
-- Tabela de configurações de branding por tenant (profile_id).
-- Permite que cada conta (EcoFerro, Fantom, etc.) tenha:
--   - Nome da empresa exibido na UI e nas etiquetas
--   - URL do logo (relativa /public/ ou absoluta https://)
--   - Cor primária (hex) para personalização visual
--   - Texto de rodapé das etiquetas internas
-- Cada profile_id tem no máximo 1 linha (UNIQUE).

CREATE TABLE IF NOT EXISTS tenant_settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL UNIQUE
                    REFERENCES app_user_profiles(id) ON DELETE CASCADE,
  company_name    TEXT    NOT NULL DEFAULT '',
  logo_url        TEXT    NOT NULL DEFAULT '',
  primary_color   TEXT    NOT NULL DEFAULT '#16a34a',
  label_footer    TEXT    NOT NULL DEFAULT '',
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_profile_id
  ON tenant_settings(profile_id);
