-- Telemetria de scrapes do Seller Center.
--
-- Cada execucao do scraper (CLI ou auto-refresh em prod) grava 1 linha aqui.
-- Permite:
--   1. Auto-deteccao de drift (endpoints mudaram, campos sumiram)
--   2. Monitorar saude do scraper (taxa de sucesso, latencia)
--   3. Trail de auditoria (quando ocorreu cada captura, com quais counters)
--
-- xhr_signatures: lista canonical de paths de XHRs interceptados
--   (ex: ["sales-omni/packs/marketshops/operations-dashboard/tabs",
--          "sales-omni/packs/marketshops/list", ...])
--   Usada pra detectar quando um endpoint conhecido deixa de aparecer
--   ou um novo aparece.

CREATE TABLE IF NOT EXISTS ml_scrape_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  scope TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  counters_json TEXT,
  total_orders INTEGER DEFAULT 0,
  xhr_count INTEGER DEFAULT 0,
  detected_store_ids_json TEXT,
  xhr_signatures_json TEXT,
  elapsed_ms INTEGER,
  error TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_ml_scrape_history_scope_captured
  ON ml_scrape_history(scope, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_scrape_history_captured
  ON ml_scrape_history(captured_at DESC);
