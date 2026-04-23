// Helper pra gravar entradas no app_audit_log.
// Use `recordAuditLog({ req, action, targetType, targetId, payload })`
// em handlers de PATCH/DELETE/POST sensíveis.

import db from "./db.js";

const insertStmt = db.prepare(`
  INSERT INTO app_audit_log (
    user_id, username, action, target_type, target_id, payload, ip, user_agent
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function getClientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    // Pode vir com múltiplos IPs separados por vírgula (primeiro = client real)
    return fwd.split(",")[0].trim().slice(0, 64);
  }
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || "";
  return String(remote || "").slice(0, 64);
}

function getUserAgent(req) {
  const ua = req.headers?.["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 256) : null;
}

/**
 * Grava entrada no audit log. Best-effort — exceções são silenciadas
 * pra não quebrar o fluxo da operação principal.
 *
 * @param {object} opts
 * @param {object} opts.req            — Express request (pra user/ip/ua)
 * @param {string} opts.action         — identificador curto (ex "stock.update")
 * @param {string} [opts.targetType]   — tipo do recurso (ex "ml_stock")
 * @param {string} [opts.targetId]     — id do recurso (ex "MLB123456")
 * @param {object|string} [opts.payload] — dados contextuais (stringified)
 */
export function recordAuditLog({ req, action, targetType, targetId, payload }) {
  try {
    if (!action) return;
    // Profile pode ter sido setado em middleware de auth (req.profile) ou
    // passado explicitamente. Tolerante a ambos + anônimo.
    const profile = req?.profile || req?.user || {};
    const userId = profile?.id ? String(profile.id).slice(0, 64) : null;
    const username = profile?.username
      ? String(profile.username).slice(0, 64)
      : null;

    const payloadStr =
      payload == null
        ? null
        : typeof payload === "string"
          ? payload.slice(0, 4000)
          : JSON.stringify(payload).slice(0, 4000);

    insertStmt.run(
      userId,
      username,
      String(action).slice(0, 64),
      targetType ? String(targetType).slice(0, 64) : null,
      targetId != null ? String(targetId).slice(0, 128) : null,
      payloadStr,
      getClientIp(req),
      getUserAgent(req)
    );
  } catch (err) {
    // Não quebra o fluxo — audit log é defesa em profundidade.
    // eslint-disable-next-line no-console
    console.error("[audit-log] falha ao gravar:", err?.message || err);
  }
}

/**
 * Query recente do audit log — pra futura tela /admin/audit.
 */
export function queryAuditLog({ limit = 100, userId = null, action = null } = {}) {
  const clauses = [];
  const params = [];
  if (userId) {
    clauses.push("user_id = ?");
    params.push(String(userId));
  }
  if (action) {
    clauses.push("action = ?");
    params.push(String(action));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const lim = Math.min(Math.max(1, Number(limit) || 100), 1000);
  return db
    .prepare(
      `SELECT id, user_id, username, action, target_type, target_id,
              payload, ip, user_agent, created_at
       FROM app_audit_log
       ${where}
       ORDER BY id DESC
       LIMIT ${lim}`
    )
    .all(...params);
}
