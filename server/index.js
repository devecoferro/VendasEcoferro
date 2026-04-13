import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import rateLimit from "express-rate-limit";

import "../api/_lib/db.js";
import { DB_PATH } from "../api/_lib/app-config.js";
import { db } from "../api/_lib/db.js";
import { getLatestConnection, listConnections } from "../api/ml/_lib/storage.js";
import { isTokenExpiringSoon } from "../api/ml/_lib/mercado-livre.js";
import createLogger from "../api/_lib/logger.js";
import { startAutoBackup, stopAutoBackup, runBackup } from "../api/_lib/backup.js";
import appAuthHandler from "../api/app-auth.js";
import appUsersHandler from "../api/app-users.js";
import mlAuthHandler from "../api/ml/auth.js";
import mlDashboardHandler from "../api/ml/dashboard.js";
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
let autoSyncRunning = false;
let activeRefreshRunning = false;
let autoSyncIntervalId = null;
let activeRefreshIntervalId = null;

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
  }, 10_000);

  // Inicia auto-backup (a cada 6h, primeiro backup 1min apos boot)
  startAutoBackup();
});
