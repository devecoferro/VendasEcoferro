-- ML Chip Drift History: snapshots of divergences between ML Seller Center
-- live chip counts and the app's internal classification.
-- Used by /api/ml/diagnostics and the periodic drift tracker.
CREATE TABLE IF NOT EXISTS ml_chip_drift_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL,
  max_abs_diff INTEGER NOT NULL,
  ml_today INTEGER NOT NULL DEFAULT 0,
  ml_upcoming INTEGER NOT NULL DEFAULT 0,
  ml_in_transit INTEGER NOT NULL DEFAULT 0,
  ml_finalized INTEGER NOT NULL DEFAULT 0,
  ml_cancelled INTEGER NOT NULL DEFAULT 0,
  app_today INTEGER NOT NULL DEFAULT 0,
  app_upcoming INTEGER NOT NULL DEFAULT 0,
  app_in_transit INTEGER NOT NULL DEFAULT 0,
  app_finalized INTEGER NOT NULL DEFAULT 0,
  app_cancelled INTEGER NOT NULL DEFAULT 0,
  diff_today INTEGER NOT NULL DEFAULT 0,
  diff_upcoming INTEGER NOT NULL DEFAULT 0,
  diff_in_transit INTEGER NOT NULL DEFAULT 0,
  diff_finalized INTEGER NOT NULL DEFAULT 0,
  diff_cancelled INTEGER NOT NULL DEFAULT 0,
  filters_json TEXT,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_ml_chip_drift_captured_at
  ON ml_chip_drift_history(captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_chip_drift_status
  ON ml_chip_drift_history(status, captured_at DESC);
