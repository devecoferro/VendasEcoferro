CREATE TABLE IF NOT EXISTS ml_stock (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sku TEXT,
  title TEXT,
  available_quantity INTEGER NOT NULL DEFAULT 0,
  sold_quantity INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  condition TEXT,
  listing_type TEXT,
  price REAL,
  thumbnail TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE CASCADE,
  UNIQUE (connection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_stock_connection
ON ml_stock(connection_id);

CREATE INDEX IF NOT EXISTS idx_ml_stock_seller_item
ON ml_stock(seller_id, item_id);

CREATE INDEX IF NOT EXISTS idx_ml_stock_sku
ON ml_stock(sku);
