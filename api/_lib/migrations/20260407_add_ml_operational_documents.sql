CREATE TABLE IF NOT EXISTS ml_shipping_label_documents (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  document_key TEXT NOT NULL UNIQUE,
  order_id TEXT,
  shipment_id TEXT NOT NULL,
  pack_id TEXT,
  source TEXT NOT NULL,
  label_format TEXT,
  label_content_type TEXT,
  label_url TEXT,
  label_payload TEXT,
  storage_key TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ml_invoice_documents (
  id TEXT PRIMARY KEY,
  connection_id TEXT,
  seller_id TEXT NOT NULL,
  document_key TEXT NOT NULL UNIQUE,
  order_id TEXT,
  shipment_id TEXT,
  pack_id TEXT,
  invoice_id TEXT,
  source TEXT NOT NULL,
  invoice_number TEXT,
  invoice_key TEXT,
  invoice_url TEXT,
  xml_url TEXT,
  invoice_content_type TEXT,
  xml_content_type TEXT,
  invoice_payload TEXT,
  danfe_storage_key TEXT,
  xml_storage_key TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ml_shipping_label_documents_seller_shipment
ON ml_shipping_label_documents(seller_id, shipment_id);

CREATE INDEX IF NOT EXISTS idx_ml_shipping_label_documents_order_id
ON ml_shipping_label_documents(order_id);

CREATE INDEX IF NOT EXISTS idx_ml_invoice_documents_seller_order
ON ml_invoice_documents(seller_id, order_id);

CREATE INDEX IF NOT EXISTS idx_ml_invoice_documents_seller_shipment
ON ml_invoice_documents(seller_id, shipment_id);

CREATE INDEX IF NOT EXISTS idx_ml_invoice_documents_invoice_id
ON ml_invoice_documents(invoice_id);
