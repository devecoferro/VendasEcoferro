import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { DB_PATH, DATA_DIR, ensureDataDirectory } from "../api/_lib/app-config.js";
import { db } from "../api/_lib/db.js";
import {
  ALL_LOCATIONS_ACCESS,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  buildLoginEmail,
  createPasswordHash,
  ensureDefaultAdmin,
  sanitizeAllowedLocations,
} from "../api/_lib/auth-server.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const IMPORTED_USER_PASSWORD = String(
  process.env.APP_IMPORTED_USER_PASSWORD || DEFAULT_ADMIN_PASSWORD
).trim();
const PAGE_SIZE = 500;

function assertRequiredEnv(name, value) {
  if (value) return;

  throw new Error(`Variavel obrigatoria ausente: ${name}`);
}

function nowIso() {
  return new Date().toISOString();
}

function buildTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function parseJsonSafely(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function sanitizeRole(role) {
  return role === "admin" ? "admin" : "operator";
}

async function fetchSupabaseTable(tableName) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "count=exact",
        "Range-Unit": "items",
        Range: `${from}-${to}`,
      },
    });

    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : [];

    if (!response.ok) {
      throw new Error(
        `Falha ao ler ${tableName} no Supabase: ${response.status} ${rawText || response.statusText}`
      );
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function backupExistingDatabaseIfNeeded() {
  ensureDataDirectory();

  if (!fs.existsSync(DB_PATH)) {
    return null;
  }

  const backupsDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  const backupFile = path.join(backupsDir, `pre-supabase-migration-${buildTimestamp()}.db`);
  const database = new Database(DB_PATH);

  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
    await database.backup(backupFile);
    return backupFile;
  } finally {
    database.close();
  }
}

function mapImportedUsers(rows) {
  const warnings = [];

  const users = rows.map((row) => {
    const username = String(row.username || "").trim().toLowerCase();
    const role = sanitizeRole(row.role);
    const allowedLocations =
      role === "admin"
        ? [ALL_LOCATIONS_ACCESS]
        : sanitizeAllowedLocations(parseJsonSafely(row.allowed_locations, []));

    let passwordHash = typeof row.password_hash === "string" ? row.password_hash : "";
    if (!passwordHash) {
      passwordHash = createPasswordHash(IMPORTED_USER_PASSWORD);
      warnings.push(
        `Usuario ${username || row.id} importado sem password_hash. Senha temporaria aplicada.`
      );
    }

    return {
      id: String(row.id),
      username: username || DEFAULT_ADMIN_USERNAME,
      login_email: String(row.login_email || buildLoginEmail(username || DEFAULT_ADMIN_USERNAME)),
      password_hash: passwordHash,
      role,
      allowed_locations: JSON.stringify(allowedLocations),
      active: normalizeBoolean(row.active, true) ? 1 : 0,
      created_at: String(row.created_at || nowIso()),
      updated_at: String(row.updated_at || nowIso()),
    };
  });

  return { users, warnings };
}

function mapImportedConnections(rows) {
  return rows.map((row) => ({
    id: String(row.id),
    seller_id: String(row.seller_id),
    seller_nickname: row.seller_nickname ? String(row.seller_nickname) : null,
    access_token: String(row.access_token),
    refresh_token: row.refresh_token ? String(row.refresh_token) : null,
    token_expires_at: row.token_expires_at ? String(row.token_expires_at) : null,
    last_sync_at: row.last_sync_at ? String(row.last_sync_at) : null,
    created_at: String(row.created_at || nowIso()),
    updated_at: String(row.updated_at || nowIso()),
  }));
}

function mapImportedOrders(rows) {
  return rows.map((row) => ({
    id: String(row.id),
    connection_id: String(row.connection_id),
    order_id: String(row.order_id),
    sale_number: row.sale_number ? String(row.sale_number) : null,
    sale_date: row.sale_date ? String(row.sale_date) : null,
    buyer_name: row.buyer_name ? String(row.buyer_name) : null,
    buyer_nickname: row.buyer_nickname ? String(row.buyer_nickname) : null,
    item_title: row.item_title ? String(row.item_title) : null,
    item_id: row.item_id ? String(row.item_id) : null,
    product_image_url: row.product_image_url ? String(row.product_image_url) : null,
    sku: row.sku ? String(row.sku) : null,
    quantity: Number(row.quantity || 0),
    amount: row.amount == null || Number.isNaN(Number(row.amount)) ? null : Number(row.amount),
    order_status: row.order_status ? String(row.order_status) : null,
    shipping_id: row.shipping_id ? String(row.shipping_id) : null,
    raw_data: JSON.stringify(row.raw_data || {}),
    created_at: String(row.created_at || nowIso()),
    updated_at: String(row.updated_at || nowIso()),
  }));
}

function replaceLocalData({ users, connections, orders }) {
  const insertUser = db.prepare(`
    INSERT INTO app_user_profiles (
      id,
      username,
      login_email,
      password_hash,
      role,
      allowed_locations,
      active,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @username,
      @login_email,
      @password_hash,
      @role,
      @allowed_locations,
      @active,
      @created_at,
      @updated_at
    )
  `);

  const insertConnection = db.prepare(`
    INSERT INTO ml_connections (
      id,
      seller_id,
      seller_nickname,
      access_token,
      refresh_token,
      token_expires_at,
      last_sync_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @seller_id,
      @seller_nickname,
      @access_token,
      @refresh_token,
      @token_expires_at,
      @last_sync_at,
      @created_at,
      @updated_at
    )
  `);

  const insertOrder = db.prepare(`
    INSERT INTO ml_orders (
      id,
      connection_id,
      order_id,
      sale_number,
      sale_date,
      buyer_name,
      buyer_nickname,
      item_title,
      item_id,
      product_image_url,
      sku,
      quantity,
      amount,
      order_status,
      shipping_id,
      raw_data,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @order_id,
      @sale_number,
      @sale_date,
      @buyer_name,
      @buyer_nickname,
      @item_title,
      @item_id,
      @product_image_url,
      @sku,
      @quantity,
      @amount,
      @order_status,
      @shipping_id,
      @raw_data,
      @created_at,
      @updated_at
    )
  `);

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM app_sessions").run();
    db.prepare("DELETE FROM ml_orders").run();
    db.prepare("DELETE FROM ml_connections").run();
    db.prepare("DELETE FROM app_user_profiles").run();

    for (const user of users) {
      insertUser.run(user);
    }

    for (const connection of connections) {
      insertConnection.run(connection);
    }

    for (const order of orders) {
      insertOrder.run(order);
    }
  });

  transaction();
}

async function main() {
  assertRequiredEnv("SUPABASE_URL", SUPABASE_URL);
  assertRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

  const backupFile = await backupExistingDatabaseIfNeeded();
  const [remoteUsers, remoteConnections, remoteOrders] = await Promise.all([
    fetchSupabaseTable("app_user_profiles"),
    fetchSupabaseTable("ml_connections"),
    fetchSupabaseTable("ml_orders"),
  ]);

  const { users, warnings } = mapImportedUsers(remoteUsers);
  const connections = mapImportedConnections(remoteConnections);
  const orders = mapImportedOrders(remoteOrders);

  replaceLocalData({ users, connections, orders });
  await ensureDefaultAdmin();

  console.log(
    JSON.stringify(
      {
        ok: true,
        backupFile,
        imported: {
          app_user_profiles: users.length,
          ml_connections: connections.length,
          ml_orders: orders.length,
        },
        warnings,
      },
      null,
      2
    )
  );
}

await main();
