-- Audit log de ações sensíveis (edit SKU, emitir NF-e, apagar pedido, etc)
-- Rastreabilidade e defesa em profundidade (S2 sprint de segurança).
--
-- Retention: não tem cleanup automático. Se o volume crescer muito,
-- cron pra DELETE WHERE created_at < DATE('now', '-180 days').

CREATE TABLE IF NOT EXISTS app_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,             -- id do usuário autenticado (pode ser NULL em ações anônimas)
  username TEXT,            -- snapshot do username no momento da ação (não JOIN)
  action TEXT NOT NULL,     -- ex: "stock.update", "stock.delete", "nfe.generate", "order.note"
  target_type TEXT,         -- ex: "ml_stock", "ml_order", "nfe_document"
  target_id TEXT,           -- id do recurso afetado (ex: item_id, order_id)
  payload TEXT,             -- JSON com o que mudou (ex: {"sku":{"old":"X","new":"Y"}})
  ip TEXT,                  -- IP de origem (x-forwarded-for ou connection.remoteAddress)
  user_agent TEXT,          -- User-Agent do request
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_created_at
  ON app_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_user_created
  ON app_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_action_created
  ON app_audit_log(action, created_at DESC);
