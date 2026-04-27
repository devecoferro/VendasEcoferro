// GET /api/admin/health
// Dashboard de saúde do sistema — sync status, cache, DB stats, erros.
// Admin-only.

import os from "node:os";
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

  // Uptime + memory do processo + CPU stats próprios
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const runtime = {
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: {
      rss: (mem.rss / 1024 / 1024).toFixed(1),
      heap_used: (mem.heapUsed / 1024 / 1024).toFixed(1),
      heap_total: (mem.heapTotal / 1024 / 1024).toFixed(1),
      external: (mem.external / 1024 / 1024).toFixed(1),
    },
    cpu_seconds: {
      user: (cpu.user / 1_000_000).toFixed(1),
      system: (cpu.system / 1_000_000).toFixed(1),
    },
    node_version: process.version,
  };

  // Stats do host (containerized — reflete VPS toda quando montagens
  // padrao do Docker)
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const cpus = os.cpus() || [];
  const host = {
    load_avg: os.loadavg(), // [1min, 5min, 15min]
    memory_mb: {
      total: (totalMemBytes / 1024 / 1024).toFixed(0),
      free: (freeMemBytes / 1024 / 1024).toFixed(0),
      used: ((totalMemBytes - freeMemBytes) / 1024 / 1024).toFixed(0),
      used_pct: (((totalMemBytes - freeMemBytes) / totalMemBytes) * 100).toFixed(1),
    },
    cpu_count: cpus.length,
    cpu_model: cpus[0]?.model || "unknown",
    platform: os.platform(),
    hostname: os.hostname(),
  };

  // Stats de scrape (ultimas 24h, agrupado por scope)
  let scrapeStats = null;
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = db
      .prepare(
        `SELECT scope,
                COUNT(*) AS total,
                SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS sucessos,
                ROUND(AVG(elapsed_ms)) AS avg_elapsed_ms,
                MAX(captured_at) AS last_run_at
         FROM ml_scrape_history
         WHERE captured_at >= ?
         GROUP BY scope
         ORDER BY scope`
      )
      .all(since24h);
    scrapeStats = rows.map((r) => ({
      scope: r.scope,
      total: r.total,
      sucessos: r.sucessos,
      success_rate: r.total > 0 ? Number((r.sucessos / r.total).toFixed(3)) : null,
      avg_elapsed_ms: r.avg_elapsed_ms,
      last_run_at: r.last_run_at,
    }));
  } catch {
    // tabela ml_scrape_history pode nao existir ainda
  }

  return res.json({
    success: true,
    generated_at: new Date().toISOString(),
    counts,
    last_sync: lastSync,
    db_size: dbSize,
    runtime,
    host,
    scrape_stats: scrapeStats,
    recent_audit: recentAudit,
  });
}
