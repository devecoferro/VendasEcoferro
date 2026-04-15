import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import rateLimit from "express-rate-limit";

import "../api/_lib/db.js";
import { DB_PATH } from "../api/_lib/app-config.js";
import { db } from "../api/_lib/db.js";
import {
  getLatestConnection,
  listConnections,
  purgeOrdersBeforeFloor,
} from "../api/ml/_lib/storage.js";
import { isTokenExpiringSoon } from "../api/ml/_lib/mercado-livre.js";
import createLogger from "../api/_lib/logger.js";
import { startAutoBackup, stopAutoBackup, runBackup } from "../api/_lib/backup.js";
import appAuthHandler from "../api/app-auth.js";
import appUsersHandler from "../api/app-users.js";
import mlAuthHandler from "../api/ml/auth.js";
import mlDashboardHandler from "../api/ml/dashboard.js";
import mlDiagnosticsHandler, {
  computeChipCountsDiff,
  saveChipDriftSnapshot,
  pruneChipDriftHistory,
} from "../api/ml/diagnostics.js";
import mlOrdersHandler from "../api/ml/orders.js";
import mlStoresHandler from "../api/ml/stores.js";
import mlSyncHandler, { runMercadoLivreSync, runActiveOrdersRefresh } from "../api/ml/sync.js";
import mlSyncEventsHandler from "../api/ml/sync-events.js";
import mlNotificationsHandler from "../api/ml/notifications.js";
import mlReturnsHandler from "../api/ml/returns.js";
import mlClaimsHandler from "../api/ml/claims.js";
import mlPacksHandler from "../api/ml/packs.js";
import mlOrderDocumentsHandler from "../api/ml/order-documents.js";
import mlOrderDocumentsFileHandler from "../api/ml/order-documents-file.js";
import mlPrivateSellerCenterSnapshotsHandler from "../api/ml/private-seller-center-snapshots.js";
import mlPrivateSellerCenterComparisonHandler from "../api/ml/private-seller-center-comparison.js";
import nfeGenerateHandler from "../api/nfe/generate.js";
import nfeDocumentHandler from "../api/nfe/document.js";
import nfeFileHandler from "../api/nfe/file.js";
import nfeSyncMercadoLivreHandler from "../api/nfe/sync-mercadolivre.js";
import mlStockHandler from "../api/ml/stock.js";
import mlPickingListHandler from "../api/ml/picking-list.js";
import mlConferenciaHandler from "../api/ml/conferencia.js";
import { handleSyncToWebsite } from "../api/ml/sync-to-website.js";
import { handleSyncReviews } from "../api/ml/sync-reviews.js";
import { APP_HOST, APP_PORT } from "../api/_lib/app-config.js";

const log = createLogger("server");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");

function safeDependencyHealth() {
  try {
    const latestConnection = getLatestConnection();
    const userCount =
      db.prepare("SELECT COUNT(*) AS total FROM app_user_profiles").get()?.total || 0;
    const orderCount =
      db.prepare("SELECT COUNT(*) AS total FROM ml_orders").get()?.total || 0;

    return {
      ok: true,
      database: {
        connected: true,
        path: DB_PATH,
      },
      auth: {
        users: Number(userCount || 0),
      },
      mercado_livre: latestConnection
        ? {
            connected: true,
            seller_id: latestConnection.seller_id,
            seller_nickname: latestConnection.seller_nickname,
            last_sync_at: latestConnection.last_sync_at,
            token_expiring_soon: isTokenExpiringSoon(latestConnection.token_expires_at),
            orders: Number(orderCount || 0),
          }
        : {
            connected: false,
            orders: Number(orderCount || 0),
          },
    };
  } catch (error) {
    return {
      ok: false,
      database: {
        connected: false,
        path: DB_PATH,
      },
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

const app = express();

// Traefik reverse proxy — necessário para express-rate-limit identificar IPs corretamente
app.set("trust proxy", 1);

// ─── Rate Limiting ──────────────────────────────────────────────────
// Protege rotas sensiveis contra brute force e abuso.
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos (janela menor)
  max: 50, // 50 tentativas por janela — autofill do browser gasta várias
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Muitas tentativas. Tente novamente em 5 minutos." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 120, // 120 requests/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Rate limit excedido. Aguarde um momento." },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 syncs manuais por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Sync muito frequente. Aguarde." },
});

// Gzip compression — reduz o tamanho dos assets JS/CSS em ~70%, acelerando o carregamento
app.use(compression({
  // Nao comprime respostas de API pequenas (< 1KB) para nao adicionar latencia
  threshold: 1024,
  // Nivel 6 e o padrao: bom equilibrio entre velocidade de compressao e tamanho final
  level: 6,
}));

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

// ─── Health ─────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// ─── DEBUG: Test ML API endpoints (temporary — remover após validação) ──
app.get("/api/debug/ml-api-test", async (_req, res) => {
  try {
    const { getLatestConnection } = await import("../api/ml/_lib/storage.js");
    const { ensureValidAccessToken } = await import("../api/ml/_lib/mercado-livre.js");
    const conn = getLatestConnection();
    const valid = await ensureValidAccessToken(conn);
    if (!valid?.access_token) return res.json({ error: "no token" });
    const token = valid.access_token;
    const sid = String(valid.seller_id);
    const h = { Authorization: `Bearer ${token}` };
    const results = {};

    // Test 1: orders/search with substatus filter
    const substatusTests = [
      ["rts_ready_for_pickup", `shipping.status=ready_to_ship&shipping.substatus=ready_for_pickup`],
      ["rts_picked_up", `shipping.status=ready_to_ship&shipping.substatus=picked_up`],
      ["rts_in_warehouse", `shipping.status=ready_to_ship&shipping.substatus=in_warehouse`],
      ["rts_all", `shipping.status=ready_to_ship`],
      ["pending_all", `shipping.status=pending`],
      ["shipped_all", `shipping.status=shipped`],
    ];
    for (const [label, qs] of substatusTests) {
      const r = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sid}&${qs}&limit=1`, { headers: h });
      const j = await r.json();
      results[label] = { status: r.status, total: j.paging?.total, error: j.message };
    }

    // Test 2: check shipping fields in order response
    const sampleR = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sid}&shipping.status=ready_to_ship&limit=1`, { headers: h });
    const sampleD = await sampleR.json();
    if (sampleD.results?.[0]) {
      results.sample_order_shipping = sampleD.results[0].shipping;
      results.sample_order_tags = sampleD.results[0].tags;
    }

    // Test 3: shipments single - get full details
    if (sampleD.results?.[0]?.shipping?.id) {
      const shipId = sampleD.results[0].shipping.id;
      const r3 = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, { headers: h });
      const j3 = await r3.json();
      results.shipments_single = { status: r3.status, shipping_status: j3.status, substatus: j3.substatus, keys: Object.keys(j3).slice(0, 20) };
    }

    // Test 5: Get ALL substatus totals for ready_to_ship
    const rtsSubstatuses = [
      "ready_for_pickup", "in_warehouse", "ready_to_pack", "packed",
      "picked_up", "authorized_by_carrier", "handling", "manufacturing",
      "ready_to_print", "printed", "stale", "waiting_for_carrier",
    ];
    results.rts_substatus_breakdown = {};
    let rtsSubTotal = 0;
    for (const sub of rtsSubstatuses) {
      const r = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sid}&shipping.status=ready_to_ship&shipping.substatus=${sub}&limit=1`, { headers: h });
      const j = await r.json();
      const total = j.paging?.total || 0;
      if (total > 0) results.rts_substatus_breakdown[sub] = total;
      rtsSubTotal += total;
    }
    results.rts_substatus_total = rtsSubTotal;
    results.rts_all_total = results.rts_all.total;
    results.rts_unaccounted = results.rts_all.total - rtsSubTotal;

    // Test 6: Get ALL substatus totals for shipped
    const shippedSubstatuses = [
      "out_for_delivery", "receiver_absent", "not_visited", "at_customs",
      "waiting_for_withdrawal", "in_transit", "delivered", "soon_deliver",
      "returned_to_sender", "returning_to_sender",
    ];
    results.shipped_substatus_breakdown = {};
    let shippedSubTotal = 0;
    for (const sub of shippedSubstatuses) {
      const r = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sid}&shipping.status=shipped&shipping.substatus=${sub}&limit=1`, { headers: h });
      const j = await r.json();
      const total = j.paging?.total || 0;
      if (total > 0) results.shipped_substatus_breakdown[sub] = total;
      shippedSubTotal += total;
    }
    results.shipped_substatus_total = shippedSubTotal;
    results.shipped_all_total = results.shipped_all.total;

    // Test 4: orders/{id} for full shipping details
    if (sampleD.results?.[0]?.id) {
      const ordId = sampleD.results[0].id;
      const r4 = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
      const j4 = await r4.json();
      results.single_order_shipping = j4.shipping;
    }

    // Test 7: Get actual substatuses from /shipments/{id} for a sample of rts orders
    const sampleSize = 50;
    const rtsR = await fetch(`https://api.mercadolibre.com/orders/search?seller=${sid}&shipping.status=ready_to_ship&limit=${sampleSize}&sort=date_desc`, { headers: h });
    const rtsD = await rtsR.json();
    const rtsOrders = rtsD.results || [];
    const shipIds = [...new Set(rtsOrders.map(o => o.shipping?.id).filter(Boolean))];

    const substatusCounts = {};
    const statusCounts = {};
    let shipmentsSampled = 0;

    // Batch 10 at a time
    for (let i = 0; i < Math.min(shipIds.length, 30); i++) {
      const sr = await fetch(`https://api.mercadolibre.com/shipments/${shipIds[i]}`, { headers: h });
      if (sr.ok) {
        const sj = await sr.json();
        const key = sj.status + '/' + sj.substatus;
        statusCounts[key] = (statusCounts[key] || 0) + 1;
        substatusCounts[sj.substatus] = (substatusCounts[sj.substatus] || 0) + 1;
        shipmentsSampled++;
      }
    }

    results.shipment_sample = {
      sampled: shipmentsSampled,
      total_rts_orders: rtsOrders.length,
      unique_shipping_ids: shipIds.length,
      status_substatus_distribution: statusCounts,
      substatus_distribution: substatusCounts,
    };

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health/dependencies", (_req, res) => {
  const payload = safeDependencyHealth();
  res.status(payload.ok ? 200 : 500).json(payload);
});

// ─── Auth (rate limited) ────────────────────────────────────────────
app.all("/api/app-auth", authLimiter, (req, res) => appAuthHandler(req, res));
app.all("/api/app-users", apiLimiter, (req, res) => appUsersHandler(req, res));

// ─── ML API (rate limited) ──────────────────────────────────────────
app.all("/api/ml/auth", authLimiter, (req, res) => mlAuthHandler(req, res));
app.all("/api/ml/dashboard", apiLimiter, (req, res) => mlDashboardHandler(req, res));
app.all("/api/ml/diagnostics", apiLimiter, (req, res) => mlDiagnosticsHandler(req, res));
app.all("/api/ml/orders", apiLimiter, (req, res) => mlOrdersHandler(req, res));
app.all("/api/ml/stores", apiLimiter, (req, res) => mlStoresHandler(req, res));
app.all("/api/ml/sync", syncLimiter, (req, res) => mlSyncHandler(req, res));
app.get("/api/ml/sync-events", (req, res) => mlSyncEventsHandler(req, res));
app.all("/api/ml/notifications", (req, res) => mlNotificationsHandler(req, res));
app.all("/api/ml/returns", apiLimiter, (req, res) => mlReturnsHandler(req, res));
app.all("/api/ml/claims", apiLimiter, (req, res) => mlClaimsHandler(req, res));
app.all("/api/ml/packs", apiLimiter, (req, res) => mlPacksHandler(req, res));
app.all("/api/ml/order-documents", apiLimiter, (req, res) => mlOrderDocumentsHandler(req, res));
app.all("/api/ml/order-documents/file", apiLimiter, (req, res) => mlOrderDocumentsFileHandler(req, res));
app.all("/api/ml/private-seller-center-snapshots", apiLimiter, (req, res) =>
  mlPrivateSellerCenterSnapshotsHandler(req, res)
);
app.all("/api/ml/private-seller-center-comparison", apiLimiter, (req, res) =>
  mlPrivateSellerCenterComparisonHandler(req, res)
);

// ─── NFe API (rate limited) ─────────────────────────────────────────
app.all("/api/nfe/generate", syncLimiter, (req, res) => nfeGenerateHandler(req, res));
app.all("/api/nfe/document", apiLimiter, (req, res) => nfeDocumentHandler(req, res));
app.all("/api/nfe/file", apiLimiter, (req, res) => nfeFileHandler(req, res));
app.all("/api/nfe/sync-mercadolivre", syncLimiter, (req, res) =>
  nfeSyncMercadoLivreHandler(req, res)
);
app.all("/api/ml/stock", apiLimiter, (req, res) => mlStockHandler(req, res));
app.get("/api/ml/picking-list", apiLimiter, (req, res) => mlPickingListHandler(req, res));
app.get("/api/ml/conferencia", apiLimiter, (req, res) => mlConferenciaHandler(req, res));
app.post("/api/ml/sync-to-website", syncLimiter, (req, res) => handleSyncToWebsite(req, res));
app.post("/api/ml/sync-reviews", syncLimiter, (req, res) => handleSyncReviews(req, res));

// ─── Error handler ──────────────────────────────────────────────────
app.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    if (req.path?.startsWith("/api/")) {
      return res.status(400).json({
        ok: false,
        error: "Payload JSON invalido.",
      });
    }

    return res.status(400).send("Payload JSON invalido.");
  }

  // Log de erros nao tratados
  log.error("Erro nao tratado", {
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : "Unknown",
  });

  return next(error);
});

// ─── Static files ───────────────────────────────────────────────────
// Assets com hash no nome (ex: DashboardPage-C1Uj8RxJ.js) nunca mudam — cache de 1 ano
app.use("/assets", express.static(path.join(distPath, "assets"), {
  maxAge: "1y",
  immutable: true,
}));

// index.html e arquivos raiz sem hash — sem cache para garantir atualizacao imediata
app.use(express.static(distPath, {
  maxAge: 0,
  etag: true,
}));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  return res.sendFile(path.join(distPath, "index.html"));
});

// ─── Auto-sync com Mercado Livre ────────────────────────────────────
// Sincroniza pedidos operacionais automaticamente a cada 30 segundos.
// O sync interno tem cooldown de 45s (INCREMENTAL_SYNC_COOLDOWN_MS),
// entao chamadas antes do cooldown sao ignoradas sem custo.
// Apos cada sync, um evento SSE e enviado aos clientes conectados
// para que atualizem em tempo real (sem polling pesado no frontend).
// Usa updated_from para fazer sync incremental (apenas pedidos alterados).
const AUTO_SYNC_INTERVAL_MS = 30_000; // 30 segundos
const ACTIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
// Drift snapshot: tira um retrato da divergencia entre ML e app a cada 15min.
// Fica persistido em ml_chip_drift_history para analise historica (Camada 4).
const CHIP_DRIFT_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos
// Retencao: limpa snapshots com mais de 30 dias uma vez por dia.
const CHIP_DRIFT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas
const CHIP_DRIFT_RETENTION_DAYS = 30;
let autoSyncRunning = false;
let activeRefreshRunning = false;
let autoSyncIntervalId = null;
let activeRefreshIntervalId = null;
let chipDriftSnapshotIntervalId = null;
let chipDriftPruneIntervalId = null;
let chipDriftSnapshotRunning = false;

async function autoSyncOrders() {
  if (autoSyncRunning) return; // Evita overlap se o sync anterior ainda esta rodando

  try {
    autoSyncRunning = true;
    const connections = listConnections();
    if (connections.length === 0) return; // Sem conexao ML configurada

    for (const connection of connections) {
      if (!connection?.id) continue;
      try {
        const updatedFrom = connection.last_sync_at || undefined;
        await runMercadoLivreSync({
          connectionId: connection.id,
          updatedFrom,
          pageLimit: 20,
        });
      } catch (err) {
        log.error(`Auto-sync falhou para ${connection.seller_nickname || connection.seller_id}`, err);
      }
    }
  } catch (error) {
    log.error("Auto-sync falhou", error);
  } finally {
    autoSyncRunning = false;
  }
}

// ─── Active Orders Refresh ─────────────────────────────────────────
// A cada 5 minutos, re-busca TODOS os pedidos com shipping status ativo
// (ready_to_ship, shipped) diretamente da API ML. Isso captura transicoes
// de status que o sync incremental (por date_last_updated) nao pega.
// Exemplo: pedido shipped→delivered que nao aparece no incremental sync
// porque o ML nao atualiza date_last_updated do ponto de vista do seller.
async function autoRefreshActiveOrders() {
  if (activeRefreshRunning) return;

  try {
    activeRefreshRunning = true;
    const connections = listConnections();
    if (connections.length === 0) return;

    let totalRefreshed = 0;
    for (const connection of connections) {
      if (!connection?.id) continue;
      try {
        const result = await runActiveOrdersRefresh({ connectionId: connection.id });
        totalRefreshed += result.totalRefreshed || 0;
      } catch (err) {
        log.error(`Active refresh falhou para ${connection.seller_nickname || connection.seller_id}`, err);
      }
    }
    log.info(`Active refresh concluido: ${totalRefreshed} registros atualizados (${connections.length} conexoes)`);
  } catch (error) {
    log.error("Active refresh falhou", error);
  } finally {
    activeRefreshRunning = false;
  }
}

// ─── Chip Drift Snapshot ──────────────────────────────────────────
// A cada 15 minutos, tira um snapshot do diff entre ML Seller Center
// (ml_live_chip_counts) e a classificacao interna (internal_operational_counts
// somados entre depositos). Persiste em ml_chip_drift_history — permite
// analise historica de quando os chips divergiram e por quanto.
// Silencioso em caso de falha (telemetria e best-effort).
async function autoChipDriftSnapshot() {
  if (chipDriftSnapshotRunning) return;

  try {
    chipDriftSnapshotRunning = true;
    const connections = listConnections();
    if (connections.length === 0) return; // nada pra comparar

    const result = await computeChipCountsDiff({
      tolerance: 2,
      includeBreakdown: false,
      fresh: false, // usa cache de 30s do dashboard — snapshot nao precisa ser fresh
    });

    if (result.status === "ML_API_UNAVAILABLE") return;

    const saved = saveChipDriftSnapshot(result, "cron_15min");
    if (saved && result.status === "DRIFT_DETECTED") {
      log.warn(
        `Chip drift detectado: max_abs_diff=${result.max_abs_diff} diff=${JSON.stringify(result.diff)}`
      );
    }
  } catch (error) {
    log.error(
      "Chip drift snapshot falhou",
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    chipDriftSnapshotRunning = false;
  }
}

async function autoChipDriftPrune() {
  try {
    const deleted = pruneChipDriftHistory(CHIP_DRIFT_RETENTION_DAYS);
    if (deleted > 0) {
      log.info(
        `Chip drift prune: ${deleted} snapshot(s) antigas removidos (retencao=${CHIP_DRIFT_RETENTION_DAYS}d).`
      );
    }
  } catch (error) {
    log.error(
      "Chip drift prune falhou",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
// Quando o container Docker recebe SIGTERM (restart/stop), o servidor:
// 1. Para de aceitar novas conexoes
// 2. Aguarda o sync atual terminar (se houver)
// 3. Faz backup final do banco
// 4. Fecha o banco de dados corretamente
// 5. Encerra o processo
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Shutdown iniciado (${signal})`);

  // Para auto-sync, active refresh e auto-backup
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }
  if (activeRefreshIntervalId) {
    clearInterval(activeRefreshIntervalId);
    activeRefreshIntervalId = null;
  }
  if (chipDriftSnapshotIntervalId) {
    clearInterval(chipDriftSnapshotIntervalId);
    chipDriftSnapshotIntervalId = null;
  }
  if (chipDriftPruneIntervalId) {
    clearInterval(chipDriftPruneIntervalId);
    chipDriftPruneIntervalId = null;
  }
  stopAutoBackup();

  // Aguarda sync atual terminar (max 15s)
  const shutdownStart = Date.now();
  while ((autoSyncRunning || activeRefreshRunning) && Date.now() - shutdownStart < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Backup final antes de fechar
  try {
    log.info("Backup final antes do shutdown");
    await runBackup();
  } catch (error) {
    log.error("Falha no backup final", error);
  }

  // Fecha o banco de dados
  try {
    db.close();
    log.info("Banco de dados fechado");
  } catch (error) {
    log.error("Erro ao fechar banco", error);
  }

  log.info("Shutdown concluido");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Captura erros nao tratados para nao derrubar silenciosamente
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception", error);
  // Nao faz process.exit — deixa o container reiniciar via healthcheck
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

// ─── Start ──────────────────────────────────────────────────────────
app.listen(APP_PORT, APP_HOST, () => {
  log.info(`EcoFerro running on ${APP_HOST}:${APP_PORT}`);

  // Limpa vendas antigas (anteriores ao piso 2026-04-01) no boot. Idempotente
  // — nas execucoes seguintes, zero linhas sao removidas.
  try {
    const purged = purgeOrdersBeforeFloor();
    if (purged > 0) {
      log.info(`Purge inicial: ${purged} venda(s) antigas removidas do banco.`);
    }
  } catch (err) {
    log.error("Purge inicial falhou:", err instanceof Error ? err.message : err);
  }

  // Inicia auto-sync 10s apos o boot para dar tempo do servidor estabilizar
  setTimeout(() => {
    log.info(`Auto-sync iniciado (intervalo: ${AUTO_SYNC_INTERVAL_MS / 1000}s)`);
    autoSyncIntervalId = setInterval(autoSyncOrders, AUTO_SYNC_INTERVAL_MS);
    // Primeira execucao imediata
    autoSyncOrders();

    // Active refresh: re-busca pedidos ativos a cada 5 min para manter dados frescos
    log.info(`Active refresh iniciado (intervalo: ${ACTIVE_REFRESH_INTERVAL_MS / 1000}s)`);
    activeRefreshIntervalId = setInterval(autoRefreshActiveOrders, ACTIVE_REFRESH_INTERVAL_MS);
    // Primeiro active refresh 60s apos boot (depois do primeiro incremental sync)
    setTimeout(autoRefreshActiveOrders, 60_000);

    // Chip drift snapshot: captura divergencias app vs ML a cada 15 min
    log.info(
      `Chip drift snapshot iniciado (intervalo: ${CHIP_DRIFT_SNAPSHOT_INTERVAL_MS / 60000}min)`
    );
    chipDriftSnapshotIntervalId = setInterval(
      autoChipDriftSnapshot,
      CHIP_DRIFT_SNAPSHOT_INTERVAL_MS
    );
    // Primeiro snapshot 90s apos boot (deixa o ML API estabilizar)
    setTimeout(autoChipDriftSnapshot, 90_000);

    // Prune diario do historico de drift (retencao: 30 dias)
    chipDriftPruneIntervalId = setInterval(
      autoChipDriftPrune,
      CHIP_DRIFT_PRUNE_INTERVAL_MS
    );
    // Primeiro prune 5min apos boot
    setTimeout(autoChipDriftPrune, 5 * 60 * 1000);
  }, 10_000);

  // Inicia auto-backup (a cada 6h, primeiro backup 1min apos boot)
  startAutoBackup();
});
