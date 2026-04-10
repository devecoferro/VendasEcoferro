CREATE TABLE IF NOT EXISTS ml_returns (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  order_id TEXT,
  shipment_id TEXT,
  pack_id TEXT,
  raw_status TEXT,
  raw_payload TEXT NOT NULL,
  resource_created_at TEXT,
  resource_updated_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL,
  UNIQUE (seller_id, external_id)
);

CREATE TABLE IF NOT EXISTS ml_claims (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  order_id TEXT,
  shipment_id TEXT,
  pack_id TEXT,
  raw_status TEXT,
  raw_payload TEXT NOT NULL,
  resource_created_at TEXT,
  resource_updated_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL,
  UNIQUE (seller_id, external_id)
);

CREATE TABLE IF NOT EXISTS ml_packs (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  order_id TEXT,
  shipment_id TEXT,
  pack_id TEXT,
  raw_status TEXT,
  raw_payload TEXT NOT NULL,
  resource_created_at TEXT,
  resource_updated_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL,
  UNIQUE (seller_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_returns_seller_id
  ON ml_returns(seller_id);
CREATE INDEX IF NOT EXISTS idx_ml_returns_order_id
  ON ml_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_ml_returns_shipment_id
  ON ml_returns(shipment_id);
CREATE INDEX IF NOT EXISTS idx_ml_returns_pack_id
  ON ml_returns(pack_id);
CREATE INDEX IF NOT EXISTS idx_ml_returns_last_synced_at
  ON ml_returns(last_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_claims_seller_id
  ON ml_claims(seller_id);
CREATE INDEX IF NOT EXISTS idx_ml_claims_order_id
  ON ml_claims(order_id);
CREATE INDEX IF NOT EXISTS idx_ml_claims_shipment_id
  ON ml_claims(shipment_id);
CREATE INDEX IF NOT EXISTS idx_ml_claims_pack_id
  ON ml_claims(pack_id);
CREATE INDEX IF NOT EXISTS idx_ml_claims_last_synced_at
  ON ml_claims(last_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_packs_seller_id
  ON ml_packs(seller_id);
CREATE INDEX IF NOT EXISTS idx_ml_packs_order_id
  ON ml_packs(order_id);
CREATE INDEX IF NOT EXISTS idx_ml_packs_shipment_id
  ON ml_packs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_ml_packs_pack_id
  ON ml_packs(pack_id);
CREATE INDEX IF NOT EXISTS idx_ml_packs_last_synced_at
  ON ml_packs(last_synced_at DESC);
