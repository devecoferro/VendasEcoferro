CREATE TABLE IF NOT EXISTS private_seller_center_snapshots (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  store TEXT NOT NULL,
  view_selector TEXT,
  view_label TEXT,
  selected_tab TEXT,
  selected_tab_label TEXT,
  tab_today_count INTEGER NOT NULL DEFAULT 0,
  tab_next_days_count INTEGER NOT NULL DEFAULT 0,
  tab_in_the_way_count INTEGER NOT NULL DEFAULT 0,
  tab_finished_count INTEGER NOT NULL DEFAULT 0,
  post_sale_count INTEGER NOT NULL DEFAULT 0,
  cards_payload TEXT NOT NULL,
  tasks_payload TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL,
  UNIQUE (seller_id, store, selected_tab, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_private_seller_center_snapshots_seller_store_captured
  ON private_seller_center_snapshots(seller_id, store, datetime(captured_at) DESC);

CREATE INDEX IF NOT EXISTS idx_private_seller_center_snapshots_connection_id
  ON private_seller_center_snapshots(connection_id);
