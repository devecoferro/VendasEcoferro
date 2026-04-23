// POST /api/error-log
// Recebe relatórios de erro do frontend (catch silencioso, boundary).
// Grava em app_error_log pra debugar depois via /admin/health.
//
// Autenticado (requer sessão). Rate-limited via apiLimiter.

import { db } from "./_lib/db.js";
import { requireAuthenticatedProfile } from "./_lib/auth-server.js";

const insertStmt = db.prepare(`
  INSERT INTO app_error_log (
    user_id, username, source, level, message, stack, url, user_agent, meta
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export default async function handler(req, res) {
  // Autenticação exigida pra evitar spam anônimo. Erro de login não
  // cai aqui — essa rota é pra erros pós-login do app.
  let profile = null;
  try {
    const result = await requireAuthenticatedProfile(req);
    profile = result.profile;
  } catch (error) {
    const status = error?.statusCode || 401;
    return res.status(status).json({ error: error?.message || "Nao autenticado." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const source = String(body.source || "frontend").slice(0, 64);
    const level = ["error", "warn", "info"].includes(body.level) ? body.level : "error";
    const message = String(body.message || "(sem mensagem)").slice(0, 2000);
    const stack = body.stack ? String(body.stack).slice(0, 8000) : null;
    const url = body.url ? String(body.url).slice(0, 512) : null;
    const userAgent = req.headers?.["user-agent"]
      ? String(req.headers["user-agent"]).slice(0, 512)
      : null;
    const meta = body.meta ? JSON.stringify(body.meta).slice(0, 4000) : null;

    insertStmt.run(
      profile?.id ? String(profile.id).slice(0, 64) : null,
      profile?.username ? String(profile.username).slice(0, 64) : null,
      source,
      level,
      message,
      stack,
      url,
      userAgent,
      meta
    );

    return res.status(204).end();
  } catch (err) {
    // Não crasha — pior do mundo é endpoint de logging derrubar o app
    // eslint-disable-next-line no-console
    console.error("[error-log] falha:", err?.message || err);
    return res.status(500).json({ error: "Falha ao gravar log." });
  }
}
