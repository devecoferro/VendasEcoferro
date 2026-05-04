import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import rateLimit from "express-rate-limit";

import { DB_PATH, validateRequiredEnv } from "../api/_lib/app-config.js";

// Valida env vars críticas ANTES de inicializar DB/crons (fail fast)
try {
  validateRequiredEnv();
} catch (error) {
  console.error("[server] Boot abortado:", error instanceof Error ? error.message : error);
  process.exit(1);
}

import "../api/_lib/db.js";
import { db } from "../api/_lib/db.js";
import {
  getLatestConnection,
  listConnections,
  purgeOrdersBeforeFloor,
} from "../api/ml/_lib/storage.js";
import { isTokenExpiringSoon } from "../api/ml/_lib/mercado-livre.js";
import createLogger from "../api/_lib/logger.js";
import { startAutoBackup, stopAutoBackup, runBackup } from "../api/_lib/backup.js";
import {
  ensureDefaultAdmin,
  enableDefaultAdminPasswordSync,
  disableDefaultAdminPasswordSync,
} from "../api/_lib/auth-server.js";
import appAuthHandler from "../api/app-auth.js";
import appUsersHandler from "../api/app-users.js";
import mlAuthHandler from "../api/ml/auth.js";
import mlDashboardHandler from "../api/ml/dashboard.js";
import mlDiagnosticsHandler, {
  computeChipCountsDiff,
  autoHealDrift,
  hardHealDrift,
  saveChipDriftSnapshot,
  pruneChipDriftHistory,
} from "../api/ml/diagnostics.js";
import mlOrdersHandler from "../api/ml/orders.js";
import mlStoresHandler from "../api/ml/stores.js";
import mlSyncHandler, { runMercadoLivreSync, runActiveOrdersRefresh } from "../api/ml/sync.js";
import mlSyncEventsHandler from "../api/ml/sync-events.js";
import mlNotificationsHandler from "../api/ml/notifications.js";
import { recoverMissedFeeds } from "../api/ml/_lib/missed-feeds.js";
import mlReturnsHandler from "../api/ml/returns.js";
import mlClaimsHandler from "../api/ml/claims.js";
import mlPacksHandler from "../api/ml/packs.js";
import mlOrderDocumentsHandler from "../api/ml/order-documents.js";
import mlOrderDocumentsFileHandler from "../api/ml/order-documents-file.js";
import mlPrivateSellerCenterSnapshotsHandler from "../api/ml/private-seller-center-snapshots.js";
import mlPrivateSellerCenterComparisonHandler from "../api/ml/private-seller-center-comparison.js";
import mlLiveSnapshotHandler from "../api/ml/live-snapshot.js";
import debugReportsHandler from "../api/debug-reports.js";
import debugReportsScreenshotHandler from "../api/debug-reports-screenshot.js";
import nfeGenerateHandler from "../api/nfe/generate.js";
import nfeDocumentHandler from "../api/nfe/document.js";
import nfeFileHandler from "../api/nfe/file.js";
import nfeSyncMercadoLivreHandler from "../api/nfe/sync-mercadolivre.js";
import mlStockHandler from "../api/ml/stock.js";
import mlPickingListHandler from "../api/ml/picking-list.js";
import mlConferenciaHandler from "../api/ml/conferencia.js";
import mlLabelsHandler from "../api/ml/labels.js";
import mlAdminAuditBrandsHandler from "../api/ml/admin/audit-brands.js";
import mlAdminClassifyDebugHandler from "../api/ml/admin/classify-debug.js";
import mlAdminLiveCardsDebugHandler from "../api/ml/admin/live-cards-debug.js";
import mlAdminUploadScraperStateHandler from "../api/ml/admin/upload-scraper-state.js";
import mlAdminDeleteScraperStateHandler from "../api/ml/admin/delete-scraper-state.js";
import mlAdminInstallChromiumHandler from "../api/ml/admin/install-chromium.js";
import mlImageProxyHandler from "../api/ml/image-proxy.js";
import adminAuditLogHandler from "../api/admin/audit-log.js";
import adminHealthHandler from "../api/admin/health.js";
import errorLogHandler from "../api/error-log.js";
import adminTotpHandler from "../api/admin/totp.js";
import { handleSyncToWebsite } from "../api/ml/sync-to-website.js";
import { handleSyncReviews } from "../api/ml/sync-reviews.js";
import mlLeadsHandler from "../api/ml/leads.js";
import mlSyncLeadsHandler from "../api/ml/sync-leads.js";
import mlSyncCustomersHandler from "../api/ml/sync-customers.js";
import mlFixBrandsHandler from "../api/ml/fix-brands.js";
import { runAutoEmitNfe } from "../api/nfe/_lib/auto-emit-nfe.js";
import obsidianHandler from "../api/obsidian.js";
import {
  onSyncFailed,
  onDriftDetected,
  onDriftHealed,
  onDriftPersistent,
  onUnhandledError,
  onServerStart,
  onBackupFailed,
} from "../api/_lib/obsidian-sync.js";
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

// S5 do audit: remove header X-Powered-By: Express (evita fingerprinting)
app.disable("x-powered-by");

// Traefik reverse proxy — necessário para express-rate-limit identificar IPs corretamente
app.set("trust proxy", 1);

// ─── Rate Limiting ──────────────────────────────────────────────────
// Protege rotas sensiveis contra brute force e abuso.
// AUTH-3: Separa login (agressivo) de session/logout (permissivo pro frontend
// fazer polling de session sem travar o próprio usuário).
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10, // 10 tentativas por IP / 5min pra login (era 50 agregado)
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Só limita action=login. Outras actions (session, logout) usam authLimiter.
    try {
      const action = req.body?.action || req.query?.action;
      return action !== "login";
    } catch {
      return true;
    }
  },
  message: { ok: false, error: "Muitas tentativas de login. Tente em 5 minutos." },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200, // session polling/logout pode ser alto
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Muitas requisições. Tente novamente em 5 minutos." },
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

// Limiter dedicado pra emissao de NF-e. Operador legitimo pode ter 30+
// pedidos pra emitir em sequencia (cada NF-e leva ~3-5s no ML, processado
// em serie via handleGenerateNFeBulk). Antes usava syncLimiter (10/min)
// que bloqueava no 11o pedido com 429. 60/min = 1 NF-e por segundo,
// folga real pro uso operacional, longe de risco de abuso (ML cobra
// fiscal de quem emite).
const nfeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Muitas emissoes de NF-e em sequencia. Aguarde 1 minuto e tente de novo.",
  },
});

// S5: limiter dedicado pro image-proxy — PDFs com 50+ produtos podem
// fazer 50+ requests do proxy rapidamente (antes do cache popular).
// Gente legítima precisa mais que 120/min do apiLimiter generico.
// Bots maliciosos que tentem usar o proxy pra exfiltrar/flood: 300 rpm
// é piso que ainda limita mas permite uso real.
const imageProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Image proxy rate limit excedido." },
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

// ─── Security headers (sprint 3.1 — sem helmet, manual) ─────────────
// CSP permissiva no inicio (unsafe-inline pra inline styles do Radix e
// inline script do Vite); ajustar depois de rodar em prod. Outras
// headers sao conservadoras.
const APP_BASE_URL_SEC = String(process.env.APP_BASE_URL || "").trim();
const ALLOWED_ORIGINS_SEC = new Set(
  [APP_BASE_URL_SEC, "https://vendas.ecoferro.com.br"]
    .filter(Boolean)
    .map((u) => {
      try {
        const p = new URL(u);
        return `${p.protocol}//${p.host}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // HSTS so em producao HTTPS
  if (APP_BASE_URL_SEC.startsWith("https://")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // CSP — permissiva nas rotas /api (JSON), estrita nas rotas HTML.
  // Radix + Vite precisam de unsafe-inline pra styles; scripts ficam same-origin.
  // S8 sprint 4: hardening adicional — upgrade-insecure-requests,
  // block-all-mixed-content, object-src 'none', worker-src restritivo.
  if (!req.path.startsWith("/api")) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // imgs: self + data: + ML CDN (já whitelisted)
        "img-src 'self' data: blob: https://http2.mlstatic.com https://*.mlstatic.com",
        // style-src: unsafe-inline inevitável pra Radix/Shadcn (tentativa de
        // substituir por nonces exigiria CSS-in-JS refactor, alto risco UI).
        // fonts.googleapis.com permitido pra @import de Inter/JetBrains Mono.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        // script-src: ESTRITO — só same-origin, sem unsafe-inline/eval
        "script-src 'self'",
        // connect-src: só ML API + same-origin (bloqueia exfiltração anônima)
        "connect-src 'self' https://api.mercadolibre.com",
        // font-src: self + data: + Google Fonts CDN (Inter/JetBrains Mono)
        "font-src 'self' data: https://fonts.gstatic.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // S8: novos controles
        "object-src 'none'", // bloqueia <object>, <embed> (plugins legados)
        "worker-src 'self' blob:", // Web Workers restritos
        "manifest-src 'self'", // PWA manifest
        "upgrade-insecure-requests", // força https em requests mixos
      ].join("; ")
    );
  }
  next();
});

// ─── Origin/Referer check para rotas state-changing (sprint 2.2) ────
// Double-defense contra CSRF alem do SameSite=Strict do cookie. Bloqueia
// POST/PUT/PATCH/DELETE em /api/* se Origin/Referer nao bater com a
// whitelist. Webhook ML (/api/ml/notifications) e isento (auth propria).
// Paths relativos ao mount /api (sem o prefixo /api — Express strippa
// quando a middleware e montada com app.use("/api", ...)).
const CSRF_EXEMPT_PATHS = new Set([
  "/ml/notifications", // auth propria via secret
  "/health",
  "/health/dependencies",
]);

app.use("/api", (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  // Em dev sem APP_BASE_URL configurado, nao bloqueia (só loga).
  if (ALLOWED_ORIGINS_SEC.size === 0) return next();

  const origin = String(req.headers.origin || "").trim();
  const referer = String(req.headers.referer || "").trim();
  let candidate = origin;
  if (!candidate && referer) {
    try {
      const p = new URL(referer);
      candidate = `${p.protocol}//${p.host}`;
    } catch {
      candidate = "";
    }
  }
  if (!candidate || !ALLOWED_ORIGINS_SEC.has(candidate)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  next();
});

// ─── Health ─────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/health/dependencies", (_req, res) => {
  const payload = safeDependencyHealth();
  res.status(payload.ok ? 200 : 500).json(payload);
});

// ─── Auth (rate limited) ────────────────────────────────────────────
app.all("/api/app-auth", loginLimiter, authLimiter, (req, res) => appAuthHandler(req, res));
app.all("/api/app-users", apiLimiter, (req, res) => appUsersHandler(req, res));

// ─── ML API (rate limited) ──────────────────────────────────────────
app.all("/api/ml/auth", authLimiter, (req, res) => mlAuthHandler(req, res));
app.all("/api/ml/dashboard", apiLimiter, (req, res) => mlDashboardHandler(req, res));
app.all("/api/ml/diagnostics", apiLimiter, (req, res) => mlDiagnosticsHandler(req, res));
app.all("/api/ml/orders", apiLimiter, (req, res) => mlOrdersHandler(req, res));
app.all("/api/ml/stores", apiLimiter, (req, res) => mlStoresHandler(req, res));
app.all("/api/ml/sync", syncLimiter, (req, res) => mlSyncHandler(req, res));
app.get("/api/ml/sync-events", apiLimiter, (req, res) => mlSyncEventsHandler(req, res));
// Webhook ML — rate-limited via syncLimiter (10/min/IP). Auth adicional
// via ML_WEBHOOK_SECRET (query string ou header x-ml-webhook-secret) e
// verificada dentro do handler. Auditoria seg. sprint 1.1.
app.all("/api/ml/notifications", syncLimiter, (req, res) => mlNotificationsHandler(req, res));
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
app.all("/api/nfe/generate", nfeLimiter, (req, res) => nfeGenerateHandler(req, res));
app.all("/api/nfe/document", apiLimiter, (req, res) => nfeDocumentHandler(req, res));
app.all("/api/nfe/file", apiLimiter, (req, res) => nfeFileHandler(req, res));
app.all("/api/nfe/sync-mercadolivre", syncLimiter, (req, res) =>
  nfeSyncMercadoLivreHandler(req, res)
);
app.all("/api/ml/stock", apiLimiter, (req, res) => mlStockHandler(req, res));
app.get("/api/ml/picking-list", apiLimiter, (req, res) => mlPickingListHandler(req, res));
app.get("/api/ml/live-snapshot", apiLimiter, (req, res) => mlLiveSnapshotHandler(req, res));
// Debug reports (bugs/sugestoes dos usuarios). app.all pra cobrir GET/POST/PATCH/DELETE.
app.all("/api/debug-reports", apiLimiter, (req, res) => debugReportsHandler(req, res));
app.get("/api/debug-reports/screenshot", apiLimiter, (req, res) => debugReportsScreenshotHandler(req, res));
app.get("/api/ml/conferencia", apiLimiter, (req, res) => mlConferenciaHandler(req, res));
// Marcacao de etiquetas impressas (ReviewPage chama apos baixar PDF)
app.post("/api/ml/labels/mark-printed", apiLimiter, (req, res) => mlLabelsHandler(req, res));
app.post("/api/ml/labels/mark-unprinted", apiLimiter, (req, res) => mlLabelsHandler(req, res));
// Auditoria admin de marcas/modelos do estoque (substitui o script SSH).
// Acesso direto via browser por admin: ?format=html para HTML standalone.
app.get("/api/ml/admin/audit-brands", apiLimiter, (req, res) => mlAdminAuditBrandsHandler(req, res));
// Debug da classificacao de sub-status (validar 1:1 com ML).
// Retorna agregado por bucket × sub_status com samples de raw_data.
app.get("/api/ml/admin/classify-debug", apiLimiter, (req, res) => mlAdminClassifyDebugHandler(req, res));
// Engenharia reversa do ML — captura XHR + DOM via Playwright e expoe
// pra inspecao manual. Usado pra mapear quais endpoints internos do ML
// retornam a estrutura de cards/sub-status que queremos consumir live.
app.get("/api/ml/admin/live-cards-debug", apiLimiter, (req, res) => mlAdminLiveCardsDebugHandler(req, res));
// Upload via browser do storage state do Playwright (substitui SSH/scp).
// Aceita GET (HTML form) e POST (multipart/form-data).
app.all("/api/ml/admin/upload-scraper-state", apiLimiter, (req, res) => mlAdminUploadScraperStateHandler(req, res));
app.all("/api/ml/admin/delete-scraper-state", apiLimiter, (req, res) => mlAdminDeleteScraperStateHandler(req, res));
// Instalacao on-demand do Chromium (caso o build do Coolify nao tenha
// instalado, o que acontece se o download falhar silenciosamente).
app.all("/api/ml/admin/install-chromium", apiLimiter, (req, res) => mlAdminInstallChromiumHandler(req, res));
// Proxy de imagens do ML — usado pelo PDF do estoque (jspdf precisa do
// byte da imagem, e fetch direto bate em CORS). Whitelist de hosts no handler.
app.get("/api/ml/image-proxy", imageProxyLimiter, (req, res) => mlImageProxyHandler(req, res));
app.get("/api/admin/audit-log", apiLimiter, (req, res) => adminAuditLogHandler(req, res));
app.get("/api/admin/health", apiLimiter, (req, res) => adminHealthHandler(req, res));
app.post("/api/error-log", apiLimiter, (req, res) => errorLogHandler(req, res));
app.post("/api/admin/totp/:action", apiLimiter, (req, res) => adminTotpHandler(req, res));
app.post("/api/ml/sync-to-website", syncLimiter, (req, res) => handleSyncToWebsite(req, res));
app.post("/api/ml/sync-reviews", syncLimiter, (req, res) => handleSyncReviews(req, res));
app.get("/api/ml/leads", apiLimiter, (req, res) => mlLeadsHandler(req, res));
app.all("/api/ml/sync-leads", syncLimiter, (req, res) => mlSyncLeadsHandler(req, res));
app.all("/api/ml/sync-customers", syncLimiter, (req, res) => mlSyncCustomersHandler(req, res));
app.post("/api/ml/fix-brands", syncLimiter, (req, res) => mlFixBrandsHandler(req, res));

// ─── Obsidian API ──────────────────────────────────────────────────
app.all("/api/obsidian", apiLimiter, (req, res) => obsidianHandler(req, res));

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
// Drift snapshot: verifica divergencia ML vs app a cada 30s (mesmo cadencia
// do cache do dashboard — sem overhead extra). Persiste em
// ml_chip_drift_history apenas quando algo muda (status ou max_abs_diff)
// ou como heartbeat a cada 5min — mantem o historico enxuto mas com
// deteccao praticamente em tempo real. ML muda status de pedidos muito
// rapido, entao 15min deixaria o painel sempre em atraso.
const CHIP_DRIFT_SNAPSHOT_INTERVAL_MS = 30 * 1000; // 30 segundos
const CHIP_DRIFT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos (baseline IN_SYNC)
// Auto-heal cooldown: se drift persiste, nao adianta re-disparar active refresh
// a cada 30s — gasta ML API atoa. Cooldown de 3min entre auto-heals.
const AUTO_HEAL_COOLDOWN_MS = 3 * 60 * 1000;
// Hard-heal cooldown: mais caro (2×N ML API calls), so roda quando soft-heal
// falhou com PERSISTENT_CLASSIFICATION_BUG ou PARTIALLY_HEALED.
// Cooldown de 10min pra nao martelar a API.
const HARD_HEAL_COOLDOWN_MS = 10 * 60 * 1000;
// Circuit breaker do auto-heal: se PERSISTENT_CLASSIFICATION_BUG persistir
// por N tentativas seguidas (max_abs_diff inalterado), e bug de codigo —
// re-tentar burra ML API e CPU. Trip por TRIP_DURATION_MS, alerta uma vez,
// e so reseta em sucesso ou no fim do periodo. Resolve loop infinito visto
// no VPS em 29/04 (auto-heal a cada 3min × 1062 ML API calls cada).
const HEAL_CB_FAILURE_THRESHOLD = 3;
const HEAL_CB_TRIP_DURATION_MS = 30 * 60 * 1000;
// Retencao: limpa snapshots com mais de 30 dias uma vez por dia.
const CHIP_DRIFT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas
const CHIP_DRIFT_RETENTION_DAYS = 30;
// Missed feeds recovery — busca notificacoes ML que webhook nao recebeu
// (rede, downtime, ML desativou topico por timeout). Roda a cada 1h.
// Doc oficial: developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes
const MISSED_FEEDS_RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
// Watchdog: máximo que um cron pode rodar antes de ser considerado stuck.
// Se ultrapassar esse prazo, o lock é forçadamente resetado pra permitir
// próxima execução (o sync original continua rodando em background mas
// não bloqueia mais novos ticks).
const CRON_STUCK_TIMEOUT_MS = 5 * 60 * 1000;

let autoSyncRunning = false;
let autoSyncStartedAt = 0;
let activeRefreshRunning = false;
let activeRefreshStartedAt = 0;
let autoSyncIntervalId = null;
let activeRefreshIntervalId = null;
let chipDriftSnapshotIntervalId = null;
let chipDriftPruneIntervalId = null;
let missedFeedsRecoveryIntervalId = null;
let missedFeedsRecoveryRunning = false;
let chipDriftSnapshotRunning = false;
let chipDriftSnapshotStartedAt = 0;
let lastPersistedChipDrift = null; // { status, max_abs_diff } do ultimo snapshot gravado
let lastChipDriftHeartbeatAt = 0; // epoch ms do ultimo heartbeat gravado
let lastAutoHealAt = 0; // epoch ms do ultimo auto-heal disparado
let lastHardHealAt = 0; // epoch ms do ultimo hard-heal disparado
let healConsecutiveFailures = 0; // contagem de PERSISTENT_CLASSIFICATION_BUG seguidos
let healCircuitTrippedUntil = 0; // epoch ms — ate quando suprimir auto-heal
let healCircuitTrippedLogged = false; // alerta ja emitido no trip atual?

// P7: pula auto-sync quando nao houver atividade recente de sessao. Se
// ninguem usou o app nas ultimas 15min, nao vale torrar ML API.
// Override: ALWAYS_AUTO_SYNC=1 mantem comportamento antigo (util pra
// cron/background apps que dependem de sync mesmo sem UI).
const ACTIVE_SESSION_WINDOW_MS = 15 * 60 * 1000;
const ALWAYS_AUTO_SYNC =
  String(process.env.ALWAYS_AUTO_SYNC || "").toLowerCase() === "1" ||
  String(process.env.ALWAYS_AUTO_SYNC || "").toLowerCase() === "true";

function hasActiveSession() {
  if (ALWAYS_AUTO_SYNC) return true;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM app_sessions
         WHERE datetime(last_seen_at) > datetime('now', '-' || ? || ' seconds')`
      )
      .get(Math.floor(ACTIVE_SESSION_WINDOW_MS / 1000));
    return Number(row?.n || 0) > 0;
  } catch {
    return true; // tolera — melhor sincar do que nao sincar em erro
  }
}

async function autoSyncOrders() {
  // Watchdog: se autoSyncRunning está true há mais de 5min, considera stuck
  // e reseta flag (promise original pode continuar em bg, mas não bloqueia).
  if (autoSyncRunning) {
    if (Date.now() - autoSyncStartedAt > CRON_STUCK_TIMEOUT_MS) {
      log.warn(`Auto-sync stuck por ${Math.round((Date.now() - autoSyncStartedAt) / 1000)}s — resetando flag`);
      autoSyncRunning = false;
    } else {
      return;
    }
  }
  autoSyncStartedAt = Date.now();

  // P7: skip quando ninguém usou o app há 15min. Economiza API calls ML.
  if (!hasActiveSession()) return;

  try {
    autoSyncRunning = true;
    const connections = listConnections();
    if (connections.length === 0) return; // Sem conexao ML configurada

    for (const connection of connections) {
      if (!connection?.id) continue;
      try {
        // MLS-3: aplica margem de 2min no updated_from pra compensar clock skew
        // entre servidor local e ML. Sem isso, pedidos atualizados no ML com
        // timestamp alguns segundos antes do last_sync_at podiam sumir.
        let updatedFrom = connection.last_sync_at || undefined;
        if (updatedFrom) {
          const margin = new Date(new Date(updatedFrom).getTime() - 2 * 60 * 1000);
          if (!Number.isNaN(margin.getTime())) {
            updatedFrom = margin.toISOString();
          }
        }
        await runMercadoLivreSync({
          connectionId: connection.id,
          updatedFrom,
          pageLimit: 20,
        });
      } catch (err) {
        log.error(`Auto-sync falhou para ${connection.seller_nickname || connection.seller_id}`, err);
        onSyncFailed(connection.seller_nickname || connection.seller_id, err).catch(() => {});
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
  if (activeRefreshRunning) {
    if (Date.now() - activeRefreshStartedAt > CRON_STUCK_TIMEOUT_MS) {
      log.warn(`Active refresh stuck por ${Math.round((Date.now() - activeRefreshStartedAt) / 1000)}s — resetando flag`);
      activeRefreshRunning = false;
    } else {
      return;
    }
  }
  activeRefreshStartedAt = Date.now();

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
// A cada 30s verifica o diff entre ML Seller Center (ml_live_chip_counts)
// e a classificacao interna (internal_operational_counts somados entre
// depositos). Persiste em ml_chip_drift_history APENAS quando:
//   (a) status muda (IN_SYNC <-> DRIFT_DETECTED),
//   (b) max_abs_diff muda,
//   (c) se passaram 5 min desde o ultimo heartbeat (baseline).
// Quando drift e detectado, dispara autoHealDrift() — forca refresh dos
// pedidos ativos e re-verifica. Se o drift era so timing (dados stale),
// auto-corrige. Se persistir, e bug de classificacao (alerta de severidade).
// Throttle de auto-heal: so roda 1x a cada AUTO_HEAL_COOLDOWN_MS para nao
// sobrecarregar a ML API caso o bug seja persistente.
async function autoChipDriftSnapshot() {
  if (chipDriftSnapshotRunning) {
    if (Date.now() - chipDriftSnapshotStartedAt > CRON_STUCK_TIMEOUT_MS) {
      log.warn(`Chip drift snapshot stuck — resetando flag`);
      chipDriftSnapshotRunning = false;
    } else {
      return;
    }
  }
  chipDriftSnapshotStartedAt = Date.now();

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

    // Auto-heal: se drift detectado e nao rodamos heal recentemente, dispara
    const now = Date.now();
    let finalResult = result;
    let healOutcome = null;
    let hardHealOutcome = null;
    // Circuit breaker: se ja trippamos, suprime auto-heal ate cooldown vencer.
    // So loga o alerta uma vez por trip — drift continua sendo registrado nos
    // heartbeats normais, mas nao chamamos ML API atoa.
    const cbActive = now < healCircuitTrippedUntil;
    if (cbActive && !healCircuitTrippedLogged) {
      log.warn(
        `Auto-heal circuit breaker ATIVO ate ${new Date(healCircuitTrippedUntil).toISOString()} — drift sera ignorado ate la (bug de classificacao persistente)`
      );
      healCircuitTrippedLogged = true;
    }

    if (
      result.status === "DRIFT_DETECTED" &&
      !cbActive &&
      now - lastAutoHealAt >= AUTO_HEAL_COOLDOWN_MS
    ) {
      lastAutoHealAt = now;
      log.info(
        `Chip drift detectado — tentando auto-heal (max_abs_diff=${result.max_abs_diff})`
      );
      onDriftDetected(result.max_abs_diff, result.diff).catch(() => {});
      try {
        const heal = await autoHealDrift({ tolerance: 2 });
        healOutcome = heal;
        // Usa o "after" como resultado final a ser persistido
        if (heal.after) finalResult = heal.after;
        if (heal.healed) {
          // Reset do circuit breaker — heal funcionou, sistema saudavel.
          healConsecutiveFailures = 0;
          healCircuitTrippedUntil = 0;
          healCircuitTrippedLogged = false;
          log.info(
            `Auto-heal SUCESSO: ${heal.reason} (${heal.refreshed_orders} pedidos refreshed, max_abs_diff ${result.max_abs_diff}→${heal.after?.max_abs_diff ?? 0})`
          );
          onDriftHealed(heal.refreshed_orders, result.max_abs_diff, heal.after?.max_abs_diff ?? 0).catch(() => {});
        } else {
          log.warn(
            `Auto-heal FALHOU: ${heal.reason} (${heal.refreshed_orders} pedidos refreshed, max_abs_diff ${result.max_abs_diff}→${heal.after?.max_abs_diff ?? result.max_abs_diff})`
          );
          // Circuit breaker: incrementa contador de falhas persistentes.
          // Se max_abs_diff nao melhorou, e bug de codigo — nao adianta retentar.
          const diffNotImproving =
            heal.reason === "PERSISTENT_CLASSIFICATION_BUG" &&
            (heal.after?.max_abs_diff ?? result.max_abs_diff) >= result.max_abs_diff;
          if (diffNotImproving) {
            healConsecutiveFailures += 1;
            if (healConsecutiveFailures >= HEAL_CB_FAILURE_THRESHOLD) {
              healCircuitTrippedUntil = now + HEAL_CB_TRIP_DURATION_MS;
              healCircuitTrippedLogged = false;
              log.warn(
                `Auto-heal circuit breaker TRIPPED — ${healConsecutiveFailures} falhas seguidas com max_abs_diff inalterado (${result.max_abs_diff}). Suprimindo por ${Math.round(HEAL_CB_TRIP_DURATION_MS / 60000)}min.`
              );
            }
          }
          // ESCALATION: soft heal não resolveu → dispara hard heal
          // (pedido-a-pedido via /orders/{id} + /shipments/{id}, sobrescreve raw_data).
          // Cooldown maior (10min) pra evitar gastar ML API atoa se o bug for
          // realmente na lógica de classificação.
          // CB tambem suprime hard-heal quando trippado.
          const shouldEscalateToHardHeal =
            (heal.reason === "PERSISTENT_CLASSIFICATION_BUG" ||
              heal.reason === "PARTIALLY_HEALED") &&
            now - lastHardHealAt >= HARD_HEAL_COOLDOWN_MS &&
            now >= healCircuitTrippedUntil;
          if (shouldEscalateToHardHeal) {
            lastHardHealAt = now;
            log.info(
              `Escalando pra hard-heal (reclassificação pedido-a-pedido via ML API)`
            );
            try {
              const hard = await hardHealDrift({ tolerance: 2, maxOrdersToRefresh: 200 });
              hardHealOutcome = hard;
              if (hard.after) finalResult = hard.after;
              if (hard.healed) {
                log.info(
                  `Hard-heal SUCESSO: ${hard.reason} (${hard.orders_refreshed} pedidos reclassificados, ${hard.divergences_before} divergentes identificados, max_abs_diff ${result.max_abs_diff}→${hard.after?.max_abs_diff ?? 0})`
                );
                onDriftHealed(hard.orders_refreshed, result.max_abs_diff, hard.after?.max_abs_diff ?? 0).catch(() => {});
              } else {
                const patterns = (hard.patterns || [])
                  .slice(0, 5)
                  .map((p) => `${p.pattern}×${p.count}`)
                  .join(", ");
                log.warn(
                  `Hard-heal FALHOU: ${hard.reason} (${hard.orders_refreshed}/${hard.divergences_before} reclassificados, max_abs_diff ${result.max_abs_diff}→${hard.after?.max_abs_diff ?? result.max_abs_diff}) — BUG DE CÓDIGO na classificação. Padrões: ${patterns || "none"}`
                );
                onDriftPersistent(hard.orders_refreshed, hard.after?.max_abs_diff ?? result.max_abs_diff, hard.reason).catch(() => {});
              }
            } catch (hardErr) {
              log.error(
                "Hard-heal falhou",
                hardErr instanceof Error ? hardErr : new Error(String(hardErr))
              );
            }
          } else {
            onDriftPersistent(heal.refreshed_orders, heal.after?.max_abs_diff ?? result.max_abs_diff, heal.reason).catch(() => {});
          }
        }
      } catch (healErr) {
        log.error(
          "Auto-heal falhou",
          healErr instanceof Error ? healErr : new Error(String(healErr))
        );
      }
    }

    // Persistencia inteligente: grava so quando muda algo, ou heartbeat
    const statusChanged =
      !lastPersistedChipDrift || lastPersistedChipDrift.status !== finalResult.status;
    const diffChanged =
      !lastPersistedChipDrift ||
      lastPersistedChipDrift.max_abs_diff !== finalResult.max_abs_diff;
    const isHeartbeat =
      now - lastChipDriftHeartbeatAt >= CHIP_DRIFT_HEARTBEAT_INTERVAL_MS;
    const shouldPersist = statusChanged || diffChanged || isHeartbeat || healOutcome != null;

    if (!shouldPersist) return;

    let source;
    if (hardHealOutcome) {
      source = hardHealOutcome.healed
        ? "cron_hard_healed"
        : hardHealOutcome.reason === "PARTIALLY_HEALED"
          ? "cron_hard_partial"
          : "cron_hard_persistent";
    } else if (healOutcome) {
      source = healOutcome.healed
        ? "cron_auto_healed"
        : healOutcome.reason === "PARTIALLY_HEALED"
          ? "cron_partial_heal"
          : "cron_persistent_drift";
    } else if (statusChanged) {
      source = "cron_status_change";
    } else if (diffChanged) {
      source = "cron_diff_change";
    } else {
      source = "cron_heartbeat";
    }

    const saved = saveChipDriftSnapshot(finalResult, source);
    if (!saved) return;

    lastPersistedChipDrift = {
      status: finalResult.status,
      max_abs_diff: finalResult.max_abs_diff,
    };
    if (isHeartbeat) lastChipDriftHeartbeatAt = now;

    if ((statusChanged || diffChanged) && !healOutcome && !hardHealOutcome) {
      if (finalResult.status === "DRIFT_DETECTED") {
        log.warn(
          `Chip drift detectado (${source}): max_abs_diff=${finalResult.max_abs_diff} diff=${JSON.stringify(finalResult.diff)}`
        );
      } else {
        log.info(
          `Chip drift voltou a IN_SYNC (max_abs_diff=${finalResult.max_abs_diff})`
        );
      }
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
let httpServer = null; // preenchido após app.listen()
let shutdownExitCode = 0;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Shutdown iniciado (${signal})`);

  // 1. Para de aceitar novas conexões HTTP
  if (httpServer) {
    await new Promise((resolve) => {
      try {
        httpServer.close((err) => {
          if (err) log.error("Erro ao fechar httpServer", err);
          resolve();
        });
      } catch (err) {
        log.error("Exception ao fechar httpServer", err);
        resolve();
      }
    });
    log.info("HTTP server fechado (sem aceitar novas conexões)");
  }

  // 2. Para todos os intervalos/crons
  if (autoSyncIntervalId) clearInterval(autoSyncIntervalId);
  if (activeRefreshIntervalId) clearInterval(activeRefreshIntervalId);
  if (chipDriftSnapshotIntervalId) clearInterval(chipDriftSnapshotIntervalId);
  if (chipDriftPruneIntervalId) clearInterval(chipDriftPruneIntervalId);
  if (missedFeedsRecoveryIntervalId) clearInterval(missedFeedsRecoveryIntervalId);
  autoSyncIntervalId = null;
  activeRefreshIntervalId = null;
  chipDriftSnapshotIntervalId = null;
  chipDriftPruneIntervalId = null;
  missedFeedsRecoveryIntervalId = null;
  stopAutoBackup();

  // 3. Aguarda todas operações atuais terminarem (max 30s)
  const shutdownStart = Date.now();
  while (
    (autoSyncRunning ||
      activeRefreshRunning ||
      chipDriftSnapshotRunning) &&
    Date.now() - shutdownStart < 30000
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (autoSyncRunning || activeRefreshRunning || chipDriftSnapshotRunning) {
    log.warn("Shutdown: algumas operações não terminaram no prazo de 30s");
  }

  // 4. Backup final antes de fechar
  try {
    log.info("Backup final antes do shutdown");
    await runBackup();
  } catch (error) {
    log.error("Falha no backup final", error);
    shutdownExitCode = 1;
    onBackupFailed(error).catch(() => {});
  }

  // 5. Fecha o banco de dados
  try {
    db.close();
    log.info("Banco de dados fechado");
  } catch (error) {
    log.error("Erro ao fechar banco", error);
    shutdownExitCode = 1;
  }

  log.info(`Shutdown concluido (exit ${shutdownExitCode})`);
  process.exit(shutdownExitCode);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Uncaught errors: logar E encerrar processo (estado interno pode estar
// corrupto — Coolify restart policy relança container).
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception — iniciando shutdown", error);
  onUnhandledError("Uncaught Exception", error).catch(() => {});
  shutdownExitCode = 1;
  // Timeout de segurança: se graceful não completa em 20s, força exit
  setTimeout(() => {
    log.error("Graceful shutdown timeout após uncaughtException — forçando exit(1)");
    process.exit(1);
  }, 20000).unref();
  gracefulShutdown("uncaughtException").catch(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error("Unhandled rejection", err);
  onUnhandledError("Unhandled Rejection", err).catch(() => {});
  // Unhandled rejection não corrompe necessariamente o state, mas é sinal
  // de bug — loga sem derrubar (comportamento atual, menos agressivo que
  // uncaughtException).
});

// ─── Start ──────────────────────────────────────────────────────────
httpServer = app.listen(APP_PORT, APP_HOST, () => {
  log.info(`EcoFerro running on ${APP_HOST}:${APP_PORT}`);
  onServerStart(APP_PORT).catch(() => {});

  // Inicializa admin default APENAS no startup (com permissão pra sync password).
  // Depois desabilita o sync pra evitar backdoor em requests normais.
  try {
    enableDefaultAdminPasswordSync();
    ensureDefaultAdmin().catch((err) => {
      log.error("ensureDefaultAdmin falhou no startup", err instanceof Error ? err : new Error(String(err)));
    }).finally(() => {
      disableDefaultAdminPasswordSync();
    });
  } catch (err) {
    log.error("Erro ao inicializar admin default", err instanceof Error ? err : new Error(String(err)));
    disableDefaultAdminPasswordSync();
  }

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

    // Chip drift snapshot: verifica divergencias app vs ML a cada 30s,
    // persiste so em mudancas ou heartbeat de 5min
    log.info(
      `Chip drift snapshot iniciado (intervalo: ${CHIP_DRIFT_SNAPSHOT_INTERVAL_MS / 1000}s, heartbeat: ${CHIP_DRIFT_HEARTBEAT_INTERVAL_MS / 60000}min)`
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

    // Missed feeds recovery — safety net pra webhooks que ML desativou.
    // Roda 1x/hora, busca /missed_feeds e processa cada notificacao
    // perdida com mesmo handler do webhook normal.
    log.info(
      `Missed feeds recovery iniciado (intervalo: ${MISSED_FEEDS_RECOVERY_INTERVAL_MS / 60000}min)`
    );
    const runMissedFeedsRecovery = async () => {
      if (missedFeedsRecoveryRunning) {
        log.warn("missed-feeds: tick anterior ainda rodando, pulando");
        return;
      }
      missedFeedsRecoveryRunning = true;
      try {
        const result = await recoverMissedFeeds();
        if (result.total_recovered > 0) {
          log.info(
            `missed-feeds: ${result.total_processed}/${result.total_recovered} processadas em ${result.duration_ms}ms`
          );
        }
      } catch (err) {
        log.error(
          "missed-feeds tick falhou",
          err instanceof Error ? err : new Error(String(err))
        );
      } finally {
        missedFeedsRecoveryRunning = false;
      }
    };
    missedFeedsRecoveryIntervalId = setInterval(
      runMissedFeedsRecovery,
      MISSED_FEEDS_RECOVERY_INTERVAL_MS
    );
    // Primeira execucao 10min apos boot (depois do sync inicial estabilizar)
    setTimeout(runMissedFeedsRecovery, 10 * 60 * 1000);

    // Auto-emit NF-e: a cada 30s, emitia automaticamente NF-e de pedidos
    // invoice_pending que já passaram 30s desde que ML sinalizou.
    //
    // DESLIGADO POR PADRÃO (2026-04-21) a pedido do operador: emissão de
    // NF-e agora é MANUAL via botão "Gerar NF-e" na MercadoLivrePage.
    //
    // Pra reativar, setar env var DISABLE_AUTO_NFE_EMIT=false no container.
    const disableAutoNfeEmit =
      String(process.env.DISABLE_AUTO_NFE_EMIT ?? "true").toLowerCase() !== "false";

    if (disableAutoNfeEmit) {
      log.info(
        "Auto-emit NF-e DESLIGADO (DISABLE_AUTO_NFE_EMIT=true). " +
        "Emissão de NF-e agora é MANUAL via botão 'Gerar NF-e'. " +
        "Pra reativar, setar DISABLE_AUTO_NFE_EMIT=false."
      );
    } else {
      let autoEmitNfeRunning = false;
      const AUTO_EMIT_NFE_INTERVAL_MS = 30_000;
      log.info(
        `Auto-emit NF-e ATIVO (intervalo: ${AUTO_EMIT_NFE_INTERVAL_MS / 1000}s, delay 30s após invoice_pending)`
      );
      setInterval(async () => {
        if (autoEmitNfeRunning) return;
        autoEmitNfeRunning = true;
        try {
          await runAutoEmitNfe();
        } catch (err) {
          log.error(
            "Auto-emit NF-e falhou",
            err instanceof Error ? err : new Error(String(err))
          );
        } finally {
          autoEmitNfeRunning = false;
        }
      }, AUTO_EMIT_NFE_INTERVAL_MS);
      // Primeira execução 2min após boot (dá tempo dos syncs pegarem dados frescos)
      setTimeout(async () => {
        try {
          await runAutoEmitNfe();
        } catch {
          /* logged */
        }
      }, 2 * 60 * 1000);
    }

    // ─── ML UI Scraper (Seller Center DOM — LEGADO, DESLIGADO) ──────
    //
    // Esta rotina chamava `scrapeMlSellerCenter` (DOM scraping de chips)
    // a cada 5min. Foi SUBSTITUÍDA pelo live-snapshot (XHR interception)
    // em `scrapeMlLiveSnapshot`, que é mais preciso e resiliente a
    // mudanças de layout.
    //
    // O live-snapshot é invocado sob demanda pelo endpoint
    // `/api/ml/live-snapshot` (usado pelo frontend) e tem seu próprio
    // auto-refresh em background via `maybeRefreshLiveSnapshotInBackground`.

    // ─── Round-robin de scopes do scraper ────────────────────────
    // Antes: só "all" era refrescado em background. Outros scopes
    // (ourinhos/full/without_deposit) só atualizavam quando alguem
    // abria o filtro correspondente — chip ficava STALE por horas.
    // Operador reportou "Ourinhos nao bate" em 2026-04-26 com chip
    // ate 17h velho.
    //
    // Solucao: cron 180s rotaciona entre os 4 scopes. Cada scope refresh
    // a cada ~12min. maybeRefreshLiveSnapshotInBackground tem dedup
    // interno (skip se cache fresh) entao o custo real e baixo.
    //
    // Why 180s (antes 60s): com 60s o warm browser pool nunca chegava
    // ao limite de idle (5min antes, 60s agora) — Chromium ficava sempre
    // alocado em memoria (~250MB constantes). Com 180s, gap entre scrapes
    // permite browser fechar e liberar RAM. Operador pode forcar refresh
    // sob demanda na UI se quiser dado fresco.
    const SCRAPER_SCOPES = ["all", "ourinhos", "full", "without_deposit"];
    let scraperScopeIndex = 0;
    let scraperRoundRobinRunning = false;
    const SCRAPER_ROUND_ROBIN_INTERVAL_MS = 180_000;
    const scraperRoundRobinIntervalId = setInterval(async () => {
      if (scraperRoundRobinRunning) return;
      scraperRoundRobinRunning = true;
      try {
        const scope = SCRAPER_SCOPES[scraperScopeIndex];
        scraperScopeIndex = (scraperScopeIndex + 1) % SCRAPER_SCOPES.length;
        const { maybeRefreshLiveSnapshotInBackground } = await import(
          "../api/ml/_lib/seller-center-scraper.js"
        );
        const result = maybeRefreshLiveSnapshotInBackground(scope);
        if (result.triggered) {
          log.info(`[scraper-rr] disparou refresh scope="${scope}"`);
        }
      } catch (err) {
        log.warn(
          `[scraper-rr] erro`,
          err instanceof Error ? err : new Error(String(err))
        );
      } finally {
        scraperRoundRobinRunning = false;
      }
    }, SCRAPER_ROUND_ROBIN_INTERVAL_MS);
    // Primeira execucao 30s apos boot — aquece SO o scope "all" (mais
    // usado pelo dashboard). Outros scopes vao rotacionar pelo round-robin
    // a cada 180s. Antes disparava os 4 em paralelo num for-loop sem
    // delay (boot+30s = 4 scrapes simultaneos), brigando pela 1 vCPU do
    // VPS — cada scrape virava 3+ min e travava a partir dali (race do
    // warm pool, browser-closed em cascata). Fix 2026-04-29.
    setTimeout(async () => {
      try {
        const { maybeRefreshLiveSnapshotInBackground } = await import(
          "../api/ml/_lib/seller-center-scraper.js"
        );
        maybeRefreshLiveSnapshotInBackground("all");
      } catch {
        /* best-effort */
      }
    }, 30_000);
    // Cleanup no shutdown
    process.on("SIGTERM", () => clearInterval(scraperRoundRobinIntervalId));
    process.on("SIGINT", () => clearInterval(scraperRoundRobinIntervalId));
  }, 10_000);

  // Inicia auto-backup (a cada 6h, primeiro backup 1min apos boot)
  startAutoBackup();
});
