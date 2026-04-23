-- M5: log de erros do frontend. Substituto minimalista de Sentry.
-- Rastreia crashes silenciosos (catch {} sem log) via endpoint dedicado.

CREATE TABLE IF NOT EXISTS app_error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  username TEXT,
  source TEXT NOT NULL,      -- ex "frontend", "pdf-export", "ml-snapshot"
  level TEXT NOT NULL,       -- "error" | "warn" | "info"
  message TEXT NOT NULL,
  stack TEXT,                -- stack trace ou contexto estruturado
  url TEXT,                  -- URL que disparou
  user_agent TEXT,
  meta TEXT,                 -- JSON adicional
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_error_log_created_at
  ON app_error_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_error_log_level_created
  ON app_error_log(level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_error_log_source_created
  ON app_error_log(source, created_at DESC);
