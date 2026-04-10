CREATE TABLE IF NOT EXISTS nfe_documents (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  ml_order_id TEXT NOT NULL,
  shipment_id TEXT,
  pack_id TEXT,
  issuer_user_id TEXT,
  invoice_id TEXT,
  invoice_number TEXT,
  invoice_series TEXT,
  invoice_key TEXT,
  authorization_protocol TEXT,
  status TEXT NOT NULL,
  transaction_status TEXT,
  environment TEXT,
  source TEXT NOT NULL,
  ml_sync_status TEXT,
  issued_at TEXT,
  authorized_at TEXT,
  xml_payload TEXT,
  danfe_storage_key TEXT,
  xml_storage_key TEXT,
  raw_payload TEXT,
  error_code TEXT,
  error_message TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL,
  UNIQUE (seller_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_nfe_documents_seller_order
ON nfe_documents(seller_id, order_id);

CREATE INDEX IF NOT EXISTS idx_nfe_documents_seller_invoice
ON nfe_documents(seller_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_nfe_documents_shipment
ON nfe_documents(shipment_id);
