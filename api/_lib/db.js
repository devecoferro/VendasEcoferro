import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { DB_PATH } from "./app-config.js";

const db = new Database(DB_PATH);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sellerCenterEntitiesMigrationPath = path.join(
  __dirname,
  "migrations",
  "20260407_add_ml_seller_center_entities.sql"
);
const privateSellerCenterSnapshotsMigrationPath = path.join(
  __dirname,
  "migrations",
  "20260407_add_private_seller_center_snapshots.sql"
);
const operationalDocumentsMigrationPath = path.join(
  __dirname,
  "migrations",
  "20260407_add_ml_operational_documents.sql"
);
const nfeDocumentsMigrationPath = path.join(
  __dirname,
  "migrations",
  "20260407_add_nfe_documents.sql"
);
const mlStockMigrationPath = path.join(
  __dirname,
  "migrations",
  "20260410_add_ml_stock.sql"
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS app_user_profiles (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    login_email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
    allowed_locations TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_seen_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user_profiles(id) ON DELETE CASCADE
  );

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

  CREATE INDEX IF NOT EXISTS idx_app_user_profiles_username
    ON app_user_profiles(username);
  CREATE INDEX IF NOT EXISTS idx_app_sessions_token_hash
    ON app_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
    ON app_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_connection_id
    ON ml_orders(connection_id);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_order_id
    ON ml_orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_order_id_sale_date
    ON ml_orders(order_id, sale_date DESC);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_sale_date
    ON ml_orders(sale_date DESC);
  CREATE INDEX IF NOT EXISTS idx_ml_orders_operational_status_sale_date_order_id
    ON ml_orders(
      lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')),
      sale_date DESC,
      order_id DESC
    );
`);

if (fs.existsSync(sellerCenterEntitiesMigrationPath)) {
  db.exec(fs.readFileSync(sellerCenterEntitiesMigrationPath, "utf8"));
}

if (fs.existsSync(privateSellerCenterSnapshotsMigrationPath)) {
  db.exec(fs.readFileSync(privateSellerCenterSnapshotsMigrationPath, "utf8"));
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_private_seller_center_snapshots_seller_store_tab_captured
    ON private_seller_center_snapshots(
      seller_id,
      store,
      selected_tab,
      captured_at DESC
    );
`);

if (fs.existsSync(operationalDocumentsMigrationPath)) {
  db.exec(fs.readFileSync(operationalDocumentsMigrationPath, "utf8"));
}

if (fs.existsSync(nfeDocumentsMigrationPath)) {
  db.exec(fs.readFileSync(nfeDocumentsMigrationPath, "utf8"));
}

if (fs.existsSync(mlStockMigrationPath)) {
  db.exec(fs.readFileSync(mlStockMigrationPath, "utf8"));
}

export { db };
