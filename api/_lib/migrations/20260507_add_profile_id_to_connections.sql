-- Migration: adiciona profile_id à tabela ml_connections para multi-tenant SaaS.
-- Permite vincular cada conexão ML a um perfil de usuário específico.
-- Conexões existentes (sem profile_id) são acessíveis por qualquer admin até
-- serem reivindicadas via re-auth ou comando administrativo.
ALTER TABLE ml_connections ADD COLUMN profile_id TEXT REFERENCES app_user_profiles(id) ON DELETE SET NULL;

-- Índice para busca rápida de conexões por perfil
CREATE INDEX IF NOT EXISTS idx_ml_connections_profile_id ON ml_connections(profile_id);
