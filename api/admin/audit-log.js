// GET /api/admin/audit-log
// Lista últimas N entradas do audit log. Admin-only.
// Query params:
//   ?limit=N (default 100, max 1000)
//   ?user_id=X (filtra por usuário)
//   ?action=X (filtra por ação, ex "stock.update")

import { requireAdmin } from "../_lib/auth-server.js";
import { queryAuditLog } from "../_lib/audit-log.js";

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

  const rows = queryAuditLog({
    limit: Number(req.query?.limit) || 100,
    userId: req.query?.user_id ? String(req.query.user_id) : null,
    action: req.query?.action ? String(req.query.action) : null,
  });

  return res.json({
    success: true,
    count: rows.length,
    entries: rows.map((r) => ({
      ...r,
      payload: r.payload ? tryParseJson(r.payload) : null,
    })),
  });
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
