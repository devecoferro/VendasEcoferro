-- 2026-04-30: granularidade de permissao por modulo/tela.
-- Antes: role=admin via tudo, role=operator via tudo - users mgmt.
-- Agora: cada user tem lista explicita de modulos permitidos.
--
-- Convencao do JSON:
--   ["*"]                      → todos os modulos (admin sempre)
--   []                         → nenhum modulo
--   ["dashboard","stock","ml"] → apenas esses
--
-- Default ["*"]: usuarios existentes mantem comportamento atual
-- (admin via tudo, operator via tudo - users — controlado pelo
-- requireAdmin nas rotas /users e /ml-diagnostics).

ALTER TABLE app_user_profiles
ADD COLUMN allowed_modules TEXT NOT NULL DEFAULT '["*"]';
