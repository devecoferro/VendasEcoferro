import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";

import "../api/_lib/db.js";
import { DB_PATH } from "../api/_lib/app-config.js";
import { db } from "../api/_lib/db.js";
import { getLatestConnection } from "../api/ml/_lib/storage.js";
import { isTokenExpiringSoon } from "../api/ml/_lib/mercado-livre.js";
import appAuthHandler from "../api/app-auth.js";
import appUsersHandler from "../api/app-users.js";
import mlAuthHandler from "../api/ml/auth.js";
import mlDashboardHandler from "../api/ml/dashboard.js";
import mlOrdersHandler from "../api/ml/orders.js";
import mlStoresHandler from "../api/ml/stores.js";
import mlSyncHandler from "../api/ml/sync.js";
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
import { APP_HOST, APP_PORT } from "../api/_lib/app-config.js";

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

// Gzip compression — reduz o tamanho dos assets JS/CSS em ~70%, acelerando o carregamento
app.use(compression({
  // Não comprime respostas de API pequenas (< 1KB) para não adicionar latência
  threshold: 1024,
  // Nível 6 é o padrão: bom equilíbrio entre velocidade de compressão e tamanho final
  level: 6,
}));

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/health/dependencies", (_req, res) => {
  const payload = safeDependencyHealth();
  res.status(payload.ok ? 200 : 500).json(payload);
});

app.all("/api/app-auth", (req, res) => appAuthHandler(req, res));
app.all("/api/app-users", (req, res) => appUsersHandler(req, res));
app.all("/api/ml/auth", (req, res) => mlAuthHandler(req, res));
app.all("/api/ml/dashboard", (req, res) => mlDashboardHandler(req, res));
app.all("/api/ml/orders", (req, res) => mlOrdersHandler(req, res));
app.all("/api/ml/stores", (req, res) => mlStoresHandler(req, res));
app.all("/api/ml/sync", (req, res) => mlSyncHandler(req, res));
app.all("/api/ml/notifications", (req, res) => mlNotificationsHandler(req, res));
app.all("/api/ml/returns", (req, res) => mlReturnsHandler(req, res));
app.all("/api/ml/claims", (req, res) => mlClaimsHandler(req, res));
app.all("/api/ml/packs", (req, res) => mlPacksHandler(req, res));
app.all("/api/ml/order-documents", (req, res) => mlOrderDocumentsHandler(req, res));
app.all("/api/ml/order-documents/file", (req, res) => mlOrderDocumentsFileHandler(req, res));
app.all("/api/ml/private-seller-center-snapshots", (req, res) =>
  mlPrivateSellerCenterSnapshotsHandler(req, res)
);
app.all("/api/ml/private-seller-center-comparison", (req, res) =>
  mlPrivateSellerCenterComparisonHandler(req, res)
);
app.all("/api/nfe/generate", (req, res) => nfeGenerateHandler(req, res));
app.all("/api/nfe/document", (req, res) => nfeDocumentHandler(req, res));
app.all("/api/nfe/file", (req, res) => nfeFileHandler(req, res));
app.all("/api/nfe/sync-mercadolivre", (req, res) =>
  nfeSyncMercadoLivreHandler(req, res)
);
app.all("/api/ml/stock", (req, res) => mlStockHandler(req, res));

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

  return next(error);
});

// Assets com hash no nome (ex: DashboardPage-C1Uj8RxJ.js) nunca mudam — cache de 1 ano
app.use("/assets", express.static(path.join(distPath, "assets"), {
  maxAge: "1y",
  immutable: true,
}));

// index.html e arquivos raiz sem hash — sem cache para garantir atualização imediata
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

app.listen(APP_PORT, APP_HOST, () => {
  console.log(`EcoFerro running on ${APP_HOST}:${APP_PORT}`);
});
