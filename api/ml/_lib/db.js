import Database from "better-sqlite3";
import { DB_PATH } from "./app-config.js";

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS ml_connections (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL UNIQUE,
    seller_nickname TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TEXT,
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ml_orders (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    sale_number TEXT,
    sale_date TEXT,
    buyer_name TEXT,
    buyer_nickname TEXT,
    item_title TEXT,
    item_id TEXT,
    product_image_url TEXT,
    sku TEXT,
    quantity INTEGER,
    amount REAL,
    order_status TEXT,
    shipping_id TEXT,
    raw_data TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ml_orders_connection_id ON ml_orders(connection_id);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_order_id ON ml_orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_sale_date ON ml_orders(sale_date DESC);
`);

export { db };
