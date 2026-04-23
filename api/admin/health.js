// GET /api/admin/health
// Dashboard de saúde do sistema — sync status, cache, DB stats, erros.
// Admin-only.

import { requireAdmin } from "../_lib/auth-server.js";
import { db } from "../_lib/db.js";

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
  } catch (error) {
    const status = error?.statusCode || 401;
    return res.status(status).json({ error: error?.message || "Acesso negado." });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET." });
  }

  // Totais do DB
  const counts = {};
  try {
    counts.ml_orders = db.prepare("SELECT COUNT(*) AS n FROM ml_orders").get()?.n || 0;
    counts.ml_stock = db.prepare("SELECT COUNT(*) AS n FROM ml_stock").get()?.n || 0;
    counts.nfe_documents = db.prepare("SELECT COUNT(*) AS n FROM nfe_documents").get()?.n || 0;
    counts.app_sessions_active = db
      .prepare("SELECT COUNT(*) AS n FROM app_sessions WHERE datetime(expires_at) > datetime('now')")
      .get()?.n || 0;
    counts.app_audit_log = db.prepare("SELECT COUNT(*) AS n FROM app_audit_log").get()?.n || 0;
  } catch (err) {
    counts._error = String(err?.message || err);
  }

  // Último sync ML
  let lastSync = null;
  try {
    const row = db
      .prepare("SELECT last_sync_at, seller_id FROM ml_connections ORDER BY last_sync_at DESC LIMIT 1")
      .get();
    if (row) {
      const lastSyncDate = row.last_sync_at ? new Date(row.last_sync_at) : null;
      lastSync = {
        at: row.last_sync_at,
        seller_id: row.seller_id,
        age_seconds: lastSyncDate
          ? Math.floor((Date.now() - lastSyncDate.getTime()) / 1000)
          : null,
      };
    }
  } catch {
    // tolerante
  }

  // Últimas 10 ações do audit
  let recentAudit = [];
  try {
    recentAudit = db
      .prepare(
        `SELECT id, username, action, target_type, target_id, created_at
         FROM app_audit_log ORDER BY id DESC LIMIT 10`
      )
      .all();
  } catch {
    // tabela pode não existir ainda
  }

  // DB file size
  let dbSize = null;
  try {
    const page = db.prepare("PRAGMA page_count").get()?.page_count || 0;
    const pageSize = db.prepare("PRAGMA page_size").get()?.page_size || 0;
    dbSize = {
      pages: page,
      page_size: pageSize,
      bytes: page * pageSize,
      mb: ((page * pageSize) / 1024 / 1024).toFixed(2),
    };
  } catch {
    // ignore
  }

  // Uptime + memory do processo
  const mem = process.memoryUsage();
  const runtime = {
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: {
      rss: (mem.rss / 1024 / 1024).toFixed(1),
      heap_used: (mem.heapUsed / 1024 / 1024).toFixed(1),
      heap_total: (mem.heapTotal / 1024 / 1024).toFixed(1),
    },
    node_version: process.version,
  };

  return res.json({
    success: true,
    generated_at: new Date().toISOString(),
    counts,
    last_sync: lastSync,
    db_size: dbSize,
    runtime,
    recent_audit: recentAudit,
  });
}
