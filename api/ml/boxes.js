/**
 * API de Caixas de Saída (Shipping Boxes)
 * Gerencia caixas para conferência de saída e relatório de despacho.
 *
 * Rotas:
 *   GET    /api/ml/boxes           — lista caixas (filtros: status, connection_id, date_from, date_to)
 *   POST   /api/ml/boxes           — cria nova caixa
 *   GET    /api/ml/boxes/:id       — detalhe de uma caixa
 *   PATCH  /api/ml/boxes/:id       — atualiza caixa (adicionar pedidos, alterar status, etc.)
 *   DELETE /api/ml/boxes/:id       — remove caixa (apenas status 'open')
 *   POST   /api/ml/boxes/:id/confirm   — confirma caixa (open → confirmed)
 *   POST   /api/ml/boxes/:id/dispatch  — despacha caixa (confirmed → dispatched)
 *   GET    /api/ml/boxes/report    — relatório consolidado por empresa e período
 */

import { randomUUID } from "node:crypto";
import { db } from "../_lib/db.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { recordAuditLog } from "../_lib/audit-log.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function generateBoxNumber(connectionId) {
  // Gera número sequencial por connection: CX-001, CX-002, ...
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM shipping_boxes WHERE connection_id = ?")
    .get(connectionId);
  const seq = (row?.cnt ?? 0) + 1;
  return `CX-${String(seq).padStart(3, "0")}`;
}

function parseOrderIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function enrichBox(box) {
  if (!box) return null;
  return {
    ...box,
    order_ids: parseOrderIds(box.order_ids),
  };
}

// ─── Handler principal ───────────────────────────────────────────────────────

export default async function boxesHandler(req, res) {
  const profile = await requireAuthenticatedProfile(req, res);
  if (!profile) return;

  const { method, url } = req;
  const urlObj = new URL(url, `http://localhost`);
  const pathname = urlObj.pathname;

  // Extrai :id do path /api/ml/boxes/:id ou /api/ml/boxes/:id/action
  const pathParts = pathname.replace(/^\/api\/ml\/boxes\/?/, "").split("/");
  const boxId = pathParts[0] || null;
  const action = pathParts[1] || null;

  try {
    // ── GET /api/ml/boxes/report ───────────────────────────────────────────
    if (method === "GET" && boxId === "report") {
      return handleReport(req, res, profile, urlObj);
    }

    // ── GET /api/ml/boxes ─────────────────────────────────────────────────
    if (method === "GET" && !boxId) {
      return handleList(req, res, profile, urlObj);
    }

    // ── POST /api/ml/boxes ────────────────────────────────────────────────
    if (method === "POST" && !boxId) {
      return handleCreate(req, res, profile);
    }

    // ── GET /api/ml/boxes/:id ─────────────────────────────────────────────
    if (method === "GET" && boxId && !action) {
      return handleGet(req, res, profile, boxId);
    }

    // ── PATCH /api/ml/boxes/:id ───────────────────────────────────────────
    if (method === "PATCH" && boxId && !action) {
      return handleUpdate(req, res, profile, boxId);
    }

    // ── DELETE /api/ml/boxes/:id ──────────────────────────────────────────
    if (method === "DELETE" && boxId && !action) {
      return handleDelete(req, res, profile, boxId);
    }

    // ── POST /api/ml/boxes/:id/confirm ────────────────────────────────────
    if (method === "POST" && boxId && action === "confirm") {
      return handleConfirm(req, res, profile, boxId);
    }

    // ── POST /api/ml/boxes/:id/dispatch ──────────────────────────────────
    if (method === "POST" && boxId && action === "dispatch") {
      return handleDispatch(req, res, profile, boxId);
    }

    return res.status(404).json({ error: "Rota não encontrada" });
  } catch (err) {
    console.error("[boxes] Erro:", err);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
}

// ─── Listar caixas ───────────────────────────────────────────────────────────

function handleList(req, res, profile, urlObj) {
  const status = urlObj.searchParams.get("status");
  const connectionId = urlObj.searchParams.get("connection_id");
  const dateFrom = urlObj.searchParams.get("date_from");
  const dateTo = urlObj.searchParams.get("date_to");
  const limit = Math.min(parseInt(urlObj.searchParams.get("limit") || "100", 10), 500);
  const offset = parseInt(urlObj.searchParams.get("offset") || "0", 10);

  let sql = "SELECT * FROM shipping_boxes WHERE 1=1";
  const params = [];

  if (status) { sql += " AND status = ?"; params.push(status); }
  if (connectionId) { sql += " AND connection_id = ?"; params.push(connectionId); }
  if (dateFrom) { sql += " AND created_at >= ?"; params.push(dateFrom); }
  if (dateTo) { sql += " AND created_at <= ?"; params.push(dateTo + "T23:59:59.999Z"); }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const boxes = db.prepare(sql).all(...params).map(enrichBox);

  // Conta total para paginação
  let countSql = "SELECT COUNT(*) as total FROM shipping_boxes WHERE 1=1";
  const countParams = params.slice(0, -2); // remove limit/offset
  if (status) countSql += " AND status = ?";
  if (connectionId) countSql += " AND connection_id = ?";
  if (dateFrom) countSql += " AND created_at >= ?";
  if (dateTo) countSql += " AND created_at <= ?";
  const { total } = db.prepare(countSql).get(...countParams);

  return res.json({ boxes, total, limit, offset });
}

// ─── Criar caixa ─────────────────────────────────────────────────────────────

function handleCreate(req, res, profile) {
  const body = req.body || {};
  const { connection_id, order_ids = [], notes, tracking_code, carrier } = body;

  if (!connection_id) {
    return res.status(400).json({ error: "connection_id é obrigatório" });
  }

  // Valida que a connection existe
  const conn = db.prepare("SELECT id, seller_nickname FROM ml_connections WHERE id = ?").get(connection_id);
  if (!conn) {
    return res.status(404).json({ error: "Conexão ML não encontrada" });
  }

  const ids = Array.isArray(order_ids) ? order_ids : [];
  let totalAmount = 0;
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const orders = db.prepare(`SELECT amount, order_status FROM ml_orders WHERE order_id IN (${placeholders})`).all(...ids);
    for (const o of orders) {
      if (!["cancelled", "returned", "not_delivered"].includes(o.order_status || "")) {
        totalAmount += typeof o.amount === "number" ? o.amount : 0;
      }
    }
  }

  const id = randomUUID();
  const now = nowIso();
  const boxNumber = generateBoxNumber(connection_id);

  db.prepare(`
    INSERT INTO shipping_boxes
      (id, box_number, connection_id, seller_nickname, order_ids, order_count, total_amount,
       status, tracking_code, carrier, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
  `).run(
    id, boxNumber, connection_id, conn.seller_nickname || "",
    JSON.stringify(ids), ids.length, totalAmount,
    tracking_code || null, carrier || null, notes || null,
    profile.id, now, now
  );

  const box = enrichBox(db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(id));

  recordAuditLog({
    user_id: profile.id,
    action: "boxes.create",
    entity_type: "shipping_box",
    entity_id: id,
    details: JSON.stringify({ box_number: boxNumber, connection_id, order_count: ids.length }),
  }).catch(() => {});

  return res.status(201).json({ box });
}

// ─── Detalhe de uma caixa ────────────────────────────────────────────────────

function handleGet(req, res, profile, boxId) {
  const box = enrichBox(db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId));
  if (!box) return res.status(404).json({ error: "Caixa não encontrada" });

  // Enriquece com dados dos pedidos
  const orders = box.order_ids.length > 0
    ? db.prepare(`SELECT order_id, sale_number, buyer_name, buyer_nickname, item_title, sku, amount, order_status FROM ml_orders WHERE order_id IN (${box.order_ids.map(() => "?").join(",")})`)
        .all(...box.order_ids)
    : [];

  return res.json({ box: { ...box, orders } });
}

// ─── Atualizar caixa ─────────────────────────────────────────────────────────

function handleUpdate(req, res, profile, boxId) {
  const box = db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId);
  if (!box) return res.status(404).json({ error: "Caixa não encontrada" });
  if (box.status === "dispatched") {
    return res.status(400).json({ error: "Caixa já despachada não pode ser editada" });
  }

  const body = req.body || {};
  const { order_ids, notes, tracking_code, carrier } = body;

  const updates = [];
  const params = [];

  if (order_ids !== undefined) {
    const ids = Array.isArray(order_ids) ? order_ids : [];
    let totalAmount = 0;
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const orders = db.prepare(`SELECT amount, order_status FROM ml_orders WHERE order_id IN (${placeholders})`).all(...ids);
      for (const o of orders) {
        if (!["cancelled", "returned", "not_delivered"].includes(o.order_status || "")) {
          totalAmount += typeof o.amount === "number" ? o.amount : 0;
        }
      }
    }
    updates.push("order_ids = ?", "order_count = ?", "total_amount = ?");
    params.push(JSON.stringify(ids), ids.length, totalAmount);
  }
  if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
  if (tracking_code !== undefined) { updates.push("tracking_code = ?"); params.push(tracking_code); }
  if (carrier !== undefined) { updates.push("carrier = ?"); params.push(carrier); }

  if (updates.length === 0) {
    return res.status(400).json({ error: "Nenhum campo para atualizar" });
  }

  updates.push("updated_at = ?");
  params.push(nowIso(), boxId);

  db.prepare(`UPDATE shipping_boxes SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = enrichBox(db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId));
  return res.json({ box: updated });
}

// ─── Remover caixa ───────────────────────────────────────────────────────────

function handleDelete(req, res, profile, boxId) {
  const box = db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId);
  if (!box) return res.status(404).json({ error: "Caixa não encontrada" });
  if (box.status !== "open") {
    return res.status(400).json({ error: "Apenas caixas abertas podem ser removidas" });
  }

  db.prepare("DELETE FROM shipping_boxes WHERE id = ?").run(boxId);

  recordAuditLog({
    user_id: profile.id,
    action: "boxes.delete",
    entity_type: "shipping_box",
    entity_id: boxId,
    details: JSON.stringify({ box_number: box.box_number }),
  }).catch(() => {});

  return res.json({ success: true });
}

// ─── Confirmar caixa ─────────────────────────────────────────────────────────

function handleConfirm(req, res, profile, boxId) {
  const box = db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId);
  if (!box) return res.status(404).json({ error: "Caixa não encontrada" });
  if (box.status !== "open") {
    return res.status(400).json({ error: `Caixa está com status '${box.status}', não pode ser confirmada` });
  }

  const now = nowIso();
  db.prepare(`
    UPDATE shipping_boxes SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?
  `).run(profile.id, now, now, boxId);

  recordAuditLog({
    user_id: profile.id,
    action: "boxes.confirm",
    entity_type: "shipping_box",
    entity_id: boxId,
    details: JSON.stringify({ box_number: box.box_number }),
  }).catch(() => {});

  const updated = enrichBox(db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId));
  return res.json({ box: updated });
}

// ─── Despachar caixa ─────────────────────────────────────────────────────────

function handleDispatch(req, res, profile, boxId) {
  const box = db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId);
  if (!box) return res.status(404).json({ error: "Caixa não encontrada" });
  if (box.status !== "confirmed") {
    return res.status(400).json({ error: `Caixa está com status '${box.status}', precisa ser confirmada antes de despachar` });
  }

  const body = req.body || {};
  const { tracking_code, carrier, dispatch_date } = body;
  const now = nowIso();

  db.prepare(`
    UPDATE shipping_boxes
    SET status = 'dispatched',
        tracking_code = COALESCE(?, tracking_code),
        carrier = COALESCE(?, carrier),
        dispatch_date = ?,
        dispatched_by = ?,
        dispatched_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    tracking_code || null, carrier || null,
    dispatch_date || now.slice(0, 10),
    profile.id, now, now, boxId
  );

  recordAuditLog({
    user_id: profile.id,
    action: "boxes.dispatch",
    entity_type: "shipping_box",
    entity_id: boxId,
    details: JSON.stringify({ box_number: box.box_number, tracking_code, carrier }),
  }).catch(() => {});

  const updated = enrichBox(db.prepare("SELECT * FROM shipping_boxes WHERE id = ?").get(boxId));
  return res.json({ box: updated });
}

// ─── Relatório ───────────────────────────────────────────────────────────────

function handleReport(req, res, profile, urlObj) {
  const dateFrom = urlObj.searchParams.get("date_from");
  const dateTo = urlObj.searchParams.get("date_to");
  const connectionId = urlObj.searchParams.get("connection_id");

  let sql = "SELECT * FROM shipping_boxes WHERE 1=1";
  const params = [];

  if (connectionId) { sql += " AND connection_id = ?"; params.push(connectionId); }
  if (dateFrom) { sql += " AND created_at >= ?"; params.push(dateFrom); }
  if (dateTo) { sql += " AND created_at <= ?"; params.push(dateTo + "T23:59:59.999Z"); }

  sql += " ORDER BY created_at DESC";

  const boxes = db.prepare(sql).all(...params).map(enrichBox);

  // Agrupa por empresa
  const byCompany = {};
  for (const box of boxes) {
    const key = box.seller_nickname || box.connection_id;
    if (!byCompany[key]) {
      byCompany[key] = {
        seller_nickname: key,
        connection_id: box.connection_id,
        total_boxes: 0,
        total_orders: 0,
        total_amount: 0,
        by_status: { open: 0, confirmed: 0, dispatched: 0 },
        boxes: [],
      };
    }
    byCompany[key].total_boxes += 1;
    byCompany[key].total_orders += box.order_count || 0;
    byCompany[key].total_amount += box.total_amount || 0;
    byCompany[key].by_status[box.status] = (byCompany[key].by_status[box.status] || 0) + 1;
    byCompany[key].boxes.push(box);
  }

  // Totais gerais
  const totals = {
    total_boxes: boxes.length,
    total_orders: boxes.reduce((s, b) => s + (b.order_count || 0), 0),
    total_amount: boxes.reduce((s, b) => s + (b.total_amount || 0), 0),
    by_status: {
      open:       boxes.filter((b) => b.status === "open").length,
      confirmed:  boxes.filter((b) => b.status === "confirmed").length,
      dispatched: boxes.filter((b) => b.status === "dispatched").length,
    },
  };

  return res.json({
    totals,
    by_company: Object.values(byCompany),
    boxes,
    filters: { date_from: dateFrom, date_to: dateTo, connection_id: connectionId },
  });
}
