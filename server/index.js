import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "../api/ml/_lib/db.js";
import mlAuthHandler from "../api/ml/auth.js";
import mlDashboardHandler from "../api/ml/dashboard.js";
import mlOrdersHandler from "../api/ml/orders.js";
import mlStoresHandler from "../api/ml/stores.js";
import mlSyncHandler from "../api/ml/sync.js";
import mlNotificationsHandler from "../api/ml/notifications.js";
import { APP_PORT } from "../api/ml/_lib/app-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distPath = path.join(projectRoot, "dist");

const app = express();

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.all("/api/ml/auth", (req, res) => mlAuthHandler(req, res));
app.all("/api/ml/dashboard", (req, res) => mlDashboardHandler(req, res));
app.all("/api/ml/orders", (req, res) => mlOrdersHandler(req, res));
app.all("/api/ml/stores", (req, res) => mlStoresHandler(req, res));
app.all("/api/ml/sync", (req, res) => mlSyncHandler(req, res));
app.all("/api/ml/notifications", (req, res) => mlNotificationsHandler(req, res));

app.use(express.static(distPath));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  return res.sendFile(path.join(distPath, "index.html"));
});

app.listen(APP_PORT, () => {
  console.log(`EcoFerro running on port ${APP_PORT}`);
});
