// ─── Debug Reports Store — armazenamento em arquivo JSON ─────────────
//
// Armazena reports de bugs, sugestões e dúvidas enviados pelos usuários
// pelo menu /report-debug. Fica em DATA_DIR (volume persistente) em:
//   - /app/data/debug-reports/reports.json  (array de reports)
//   - /app/data/debug-reports/screenshots/  (imagens base64 decoded)
//
// Escolhemos JSON em vez de SQLite pra simplicidade: não mexe no schema
// do DB principal e facilita backup manual.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./app-config.js";
import createLogger from "./logger.js";

const log = createLogger("debug-reports");

const REPORTS_DIR = path.join(DATA_DIR, "debug-reports");
const SCREENSHOTS_DIR = path.join(REPORTS_DIR, "screenshots");
const REPORTS_FILE = path.join(REPORTS_DIR, "reports.json");

function ensureDirs() {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  } catch (err) {
    log.warn("Falha ao criar dirs de reports", err instanceof Error ? err : new Error(String(err)));
  }
}

function loadReports() {
  ensureDirs();
  try {
    if (!fs.existsSync(REPORTS_FILE)) return [];
    const raw = fs.readFileSync(REPORTS_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    log.warn("Falha ao ler reports.json", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

function saveReports(reports) {
  ensureDirs();
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), "utf-8");
}

/**
 * Salva uma imagem base64 (data:image/png;base64,...) como arquivo e
 * retorna só o nome do arquivo. Usado pra não armazenar blobs gigantes
 * dentro do JSON principal.
 *
 * Limite de 2MB por imagem (decodificada) pra evitar abuso.
 */
function saveScreenshot(dataUrl, reportId) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return null;
  }
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  const b64 = match[2];

  // Limita 2MB decodificado
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length > 2 * 1024 * 1024) {
    log.warn(`Screenshot muito grande (${buffer.length} bytes) — descartando`);
    return null;
  }

  ensureDirs();
  const safeExt = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? ext : "png";
  const filename = `${reportId}-${crypto.randomUUID()}.${safeExt}`;
  const fullPath = path.join(SCREENSHOTS_DIR, filename);
  try {
    fs.writeFileSync(fullPath, buffer);
    return filename;
  } catch (err) {
    log.warn(`Falha ao salvar screenshot ${filename}`, err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/**
 * Lê o arquivo da screenshot do disco (pra servir via GET).
 * Retorna Buffer ou null.
 */
export function readScreenshot(filename) {
  if (typeof filename !== "string") return null;
  // Sanitiza: só aceita caracteres do pattern typical, sem path traversal.
  if (!/^[a-z0-9-]+\.(png|jpg|jpeg|gif|webp)$/i.test(filename)) {
    return null;
  }
  const fullPath = path.join(SCREENSHOTS_DIR, filename);
  try {
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  } catch {
    return null;
  }
}

export function getScreenshotContentType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Cria um novo report.
 */
export function createReport({
  userId,
  username,
  type,
  title,
  description,
  screen,
  priority,
  screenshotsDataUrls,
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Salva screenshots e guarda só os filenames
  const screenshotFilenames = [];
  if (Array.isArray(screenshotsDataUrls)) {
    for (const dataUrl of screenshotsDataUrls) {
      const filename = saveScreenshot(dataUrl, id);
      if (filename) screenshotFilenames.push(filename);
    }
  }

  const report = {
    id,
    user_id: userId,
    username,
    type: ["bug", "suggestion", "question"].includes(type) ? type : "bug",
    title: String(title || "").slice(0, 200),
    description: String(description || "").slice(0, 5000),
    screen: screen ? String(screen).slice(0, 100) : null,
    priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
    screenshots: screenshotFilenames,
    status: "open",
    admin_notes: null,
    created_at: now,
    updated_at: now,
  };

  const reports = loadReports();
  reports.unshift(report); // mais novo primeiro
  saveReports(reports);

  return report;
}

/**
 * Lista reports. Se user não é admin, só vê os próprios.
 * Filtra por status/type opcionalmente.
 */
export function listReports({ userId, isAdmin, status, type } = {}) {
  const all = loadReports();
  return all.filter((r) => {
    if (!isAdmin && r.user_id !== userId) return false;
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    return true;
  });
}

/**
 * Atualiza um report. Apenas admin pode atualizar status e admin_notes.
 */
export function updateReport(id, updates, { isAdmin }) {
  if (!isAdmin) {
    const err = new Error("Apenas administrador pode atualizar reports.");
    err.statusCode = 403;
    throw err;
  }

  const reports = loadReports();
  const idx = reports.findIndex((r) => r.id === id);
  if (idx < 0) {
    const err = new Error("Report não encontrado.");
    err.statusCode = 404;
    throw err;
  }

  const allowedFields = ["status", "admin_notes", "priority"];
  const updated = { ...reports[idx], updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (field in updates) {
      updated[field] = updates[field];
    }
  }

  reports[idx] = updated;
  saveReports(reports);
  return updated;
}

/**
 * Deleta um report. Apenas admin. Remove screenshots associados.
 */
export function deleteReport(id, { isAdmin }) {
  if (!isAdmin) {
    const err = new Error("Apenas administrador pode deletar reports.");
    err.statusCode = 403;
    throw err;
  }

  const reports = loadReports();
  const idx = reports.findIndex((r) => r.id === id);
  if (idx < 0) {
    const err = new Error("Report não encontrado.");
    err.statusCode = 404;
    throw err;
  }

  // Remove screenshots do disco
  const toDelete = reports[idx];
  for (const filename of toDelete.screenshots || []) {
    try {
      const fullPath = path.join(SCREENSHOTS_DIR, filename);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      // best-effort
    }
  }

  reports.splice(idx, 1);
  saveReports(reports);
  return { deleted: true, id };
}

/**
 * Estatísticas agregadas (pra dashboard de admin).
 */
export function getReportsSummary() {
  const all = loadReports();
  const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  const byType = { bug: 0, suggestion: 0, question: 0 };
  const byPriority = { low: 0, medium: 0, high: 0 };
  for (const r of all) {
    if (byStatus[r.status] != null) byStatus[r.status]++;
    if (byType[r.type] != null) byType[r.type]++;
    if (byPriority[r.priority] != null) byPriority[r.priority]++;
  }
  return { total: all.length, by_status: byStatus, by_type: byType, by_priority: byPriority };
}
