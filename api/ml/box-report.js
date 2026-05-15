/**
 * box-report.js — Conferência de Saída e Relatório de Caixas
 *
 * Fluxo:
 *  1. Operador lê QR/barcode na tela Conferência de Saída
 *  2. Frontend chama GET /lookup para buscar dados do pedido
 *  3. Frontend chama POST /conferencia para registrar a leitura no banco
 *  4. Relatório de Caixas lê da tabela `conferencia_saida` (não do ML direto)
 *
 * Endpoints:
 *  GET  /api/ml/box-report/lookup        — busca pedido por sale_number/shipping_id/pack_id
 *  POST /api/ml/box-report/conferencia   — registra leitura na tabela conferencia_saida
 *  GET  /api/ml/box-report/summary       — totais do relatório (da conferencia_saida)
 *  GET  /api/ml/box-report/daily         — série diária (da conferencia_saida)
 *  GET  /api/ml/box-report/list          — lista detalhada (da conferencia_saida)
 */

import { db } from "../_lib/db.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDateRange(query) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thirtyAgoStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    dateFrom: query.date_from || thirtyAgoStr,
    dateTo: query.date_to || todayStr,
  };
}

function getCompanyMap() {
  const rows = db
    .prepare("SELECT id, seller_nickname, seller_id FROM ml_connections")
    .all();
  const map = {};
  for (const r of rows) {
    map[r.id] = r.seller_nickname || `Seller ${r.seller_id}`;
  }
  return map;
}

function todaySP() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * GET /api/ml/box-report/lookup?q=VALUE
 * Busca pedido pelo QR Code (JSON do ML), sale_number, order_id ou pack_id.
 */
export async function handleLookup(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const raw = String(req.query.q || "").trim();
  if (!raw) return res.status(400).json({ error: "Parâmetro q obrigatório." });

  // Detecta JSON do QR Code da etiqueta ML: {"id":"47052305648","t":"lm"}
  let q = raw;
  let isShippingIdLookup = false;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id) {
      q = String(parsed.id);
      isShippingIdLookup = true;
    }
  } catch {
    // não é JSON — usa o valor direto
  }

  const companyMap = getCompanyMap();

  try {
    let rows = [];

    // 1. Se veio do QR do ML (shipping_id)
    if (isShippingIdLookup) {
      rows = db.prepare(
        `SELECT sale_number, order_id, connection_id, buyer_name, item_title, sku, amount, quantity,
                json_extract(raw_data, '$.pack_id') AS pack_id,
                json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
                shipping_id, sale_date
         FROM ml_orders WHERE shipping_id = ?`
      ).all(q);
    }

    // 2. Fallback: sale_number ou order_id
    if (rows.length === 0) {
      rows = db.prepare(
        `SELECT sale_number, order_id, connection_id, buyer_name, item_title, sku, amount, quantity,
                json_extract(raw_data, '$.pack_id') AS pack_id,
                json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
                shipping_id, sale_date
         FROM ml_orders WHERE sale_number = ? OR order_id = ?`
      ).all(q, q);
    }

    // 3. Fallback: pack_id
    if (rows.length === 0) {
      rows = db.prepare(
        `SELECT sale_number, order_id, connection_id, buyer_name, item_title, sku, amount, quantity,
                json_extract(raw_data, '$.pack_id') AS pack_id,
                json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
                shipping_id, sale_date
         FROM ml_orders WHERE json_extract(raw_data, '$.pack_id') = ?`
      ).all(q);
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pedido não encontrado.", q });
    }

    const isPack = rows.length > 1 || rows[0].pack_id != null;
    const connectionId = rows[0].connection_id;
    const company = companyMap[connectionId] || connectionId;
    const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const totalQty = rows.reduce((s, r) => s + (r.quantity || 1), 0);

    return res.json({
      found: true,
      q,
      is_pack: isPack,
      pack_id: rows[0].pack_id,
      connection_id: connectionId,
      company,
      ship_status: rows[0].ship_status,
      shipping_id: rows[0].shipping_id,
      total_amount: totalAmount,
      total_qty: totalQty,
      orders: rows.map((r) => ({
        sale_number: r.sale_number,
        order_id: r.order_id,
        buyer_name: r.buyer_name,
        item_title: r.item_title,
        sku: r.sku,
        amount: r.amount,
        quantity: r.quantity,
        sale_date: r.sale_date,
      })),
    });
  } catch (err) {
    console.error("[box-report] lookup error:", err);
    res.status(500).json({ error: err.message });
  }
}

// ─── Registrar conferência ────────────────────────────────────────────────────

/**
 * POST /api/ml/box-report/conferencia
 * Registra uma leitura na tabela conferencia_saida.
 *
 * Body: {
 *   session_id: string,       — UUID da sessão de conferência (gerado no frontend)
 *   shipping_id: string,
 *   order_id?: string,
 *   sale_number?: string,
 *   pack_id?: string,
 *   connection_id: string,
 *   seller_nickname: string,
 *   item_title?: string,
 *   buyer_name?: string,
 *   amount: number,
 *   order_count: number,
 * }
 */
export async function handleRegistrarConferencia(req, res) {
  let profile;
  try {
    profile = await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const {
    session_id,
    shipping_id,
    order_id,
    sale_number,
    pack_id,
    connection_id,
    seller_nickname,
    item_title,
    buyer_name,
    amount,
    order_count,
  } = req.body || {};

  if (!session_id || !shipping_id || !connection_id) {
    return res.status(400).json({ error: "session_id, shipping_id e connection_id são obrigatórios." });
  }

  const sessionDate = todaySP();

  try {
    // INSERT OR IGNORE — se já foi lida nesta sessão, ignora silenciosamente
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO conferencia_saida
        (session_id, session_date, shipping_id, order_id, sale_number, pack_id,
         connection_id, seller_nickname, item_title, buyer_name, amount, order_count,
         operator_id, operator_name, read_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const result = stmt.run(
      session_id,
      sessionDate,
      String(shipping_id),
      order_id ? String(order_id) : null,
      sale_number ? String(sale_number) : null,
      pack_id ? String(pack_id) : null,
      String(connection_id),
      String(seller_nickname || ""),
      item_title ? String(item_title) : null,
      buyer_name ? String(buyer_name) : null,
      Number(amount) || 0,
      Number(order_count) || 1,
      profile?.id ? String(profile.id) : null,
      profile?.name ? String(profile.name) : null,
    );

    const isDuplicate = result.changes === 0;

    return res.json({
      ok: true,
      duplicate: isDuplicate,
      session_id,
      shipping_id,
      session_date: sessionDate,
    });
  } catch (err) {
    console.error("[box-report] registrar conferencia error:", err);
    res.status(500).json({ error: err.message });
  }
}

// ─── Relatório (lê da conferencia_saida) ─────────────────────────────────────

/**
 * GET /api/ml/box-report/summary
 * Totais gerais e por empresa — baseado na tabela conferencia_saida.
 */
export async function handleSummary(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const connFilter = connection_id ? `AND connection_id = ?` : "";
  const params = connection_id
    ? [dateFrom, dateTo, connection_id]
    : [dateFrom, dateTo];

  try {
    const rows = db.prepare(`
      SELECT
        connection_id,
        seller_nickname,
        shipping_id,
        amount,
        order_count
      FROM conferencia_saida
      WHERE session_date BETWEEN ? AND ?
      ${connFilter}
    `).all(...params);

    // Deduplicar por shipping_id (caso a mesma caixa apareça em sessões diferentes)
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      if (!seen.has(r.shipping_id)) {
        seen.add(r.shipping_id);
        deduped.push(r);
      }
    }

    const totalBoxes = deduped.length;
    const totalOrders = deduped.reduce((s, r) => s + (r.order_count || 1), 0);
    const totalAmount = deduped.reduce((s, r) => s + (r.amount || 0), 0);

    const byCompany = {};
    for (const r of deduped) {
      const cid = r.connection_id;
      if (!byCompany[cid]) {
        byCompany[cid] = {
          connection_id: cid,
          seller_nickname: r.seller_nickname || cid,
          total_boxes: 0,
          total_orders: 0,
          total_amount: 0,
        };
      }
      byCompany[cid].total_boxes += 1;
      byCompany[cid].total_orders += r.order_count || 1;
      byCompany[cid].total_amount += r.amount || 0;
    }

    res.json({
      date_from: dateFrom,
      date_to: dateTo,
      totals: { total_boxes: totalBoxes, total_orders: totalOrders, total_amount: totalAmount },
      by_company: Object.values(byCompany),
    });
  } catch (err) {
    console.error("[box-report] summary error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/ml/box-report/daily
 * Série diária de caixas conferidas.
 */
export async function handleDaily(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const connFilter = connection_id ? `AND connection_id = ?` : "";
  const params = connection_id
    ? [dateFrom, dateTo, connection_id]
    : [dateFrom, dateTo];

  try {
    const rows = db.prepare(`
      SELECT
        session_date,
        connection_id,
        seller_nickname,
        shipping_id,
        amount,
        order_count
      FROM conferencia_saida
      WHERE session_date BETWEEN ? AND ?
      ${connFilter}
      ORDER BY session_date ASC
    `).all(...params);

    // Deduplicar por shipping_id dentro de cada dia
    const byDay = {};
    const seenPerDay = {};
    for (const r of rows) {
      const day = r.session_date;
      const key = `${day}:${r.shipping_id}`;
      if (seenPerDay[key]) continue;
      seenPerDay[key] = true;

      if (!byDay[day]) {
        byDay[day] = { date: day, total_boxes: 0, total_orders: 0, total_amount: 0, by_company: {} };
      }
      byDay[day].total_boxes += 1;
      byDay[day].total_orders += r.order_count || 1;
      byDay[day].total_amount += r.amount || 0;

      const nick = r.seller_nickname || r.connection_id;
      if (!byDay[day].by_company[nick]) {
        byDay[day].by_company[nick] = { boxes: 0, orders: 0, amount: 0 };
      }
      byDay[day].by_company[nick].boxes += 1;
      byDay[day].by_company[nick].orders += r.order_count || 1;
      byDay[day].by_company[nick].amount += r.amount || 0;
    }

    const series = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ date_from: dateFrom, date_to: dateTo, series });
  } catch (err) {
    console.error("[box-report] daily error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/ml/box-report/list
 * Lista detalhada de caixas conferidas.
 */
export async function handleList(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const limit = Math.min(500, parseInt(req.query.limit || "100", 10));
  const connFilter = connection_id ? `AND connection_id = ?` : "";
  const params = connection_id
    ? [dateFrom, dateTo, connection_id]
    : [dateFrom, dateTo];

  try {
    const rows = db.prepare(`
      SELECT
        shipping_id,
        connection_id,
        seller_nickname,
        session_date,
        read_at,
        order_id,
        sale_number,
        pack_id,
        item_title,
        buyer_name,
        amount,
        order_count,
        operator_name,
        session_id
      FROM conferencia_saida
      WHERE session_date BETWEEN ? AND ?
      ${connFilter}
      ORDER BY read_at DESC
    `).all(...params);

    // Deduplicar por shipping_id (mantém a leitura mais recente)
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      if (!seen.has(r.shipping_id)) {
        seen.add(r.shipping_id);
        deduped.push(r);
      }
    }

    const total = deduped.length;
    const items = deduped.slice(0, limit).map((r) => ({
      shipping_id: r.shipping_id,
      seller_nickname: r.seller_nickname,
      connection_id: r.connection_id,
      session_date: r.session_date,
      shipped_at: r.read_at,
      order_id: r.order_id,
      sale_number: r.sale_number,
      pack_id: r.pack_id,
      item_title: r.item_title,
      buyer_name: r.buyer_name,
      total_amount: r.amount || 0,
      order_count: r.order_count || 1,
      operator_name: r.operator_name,
      session_id: r.session_id,
    }));

    res.json({ date_from: dateFrom, date_to: dateTo, total, items });
  } catch (err) {
    console.error("[box-report] list error:", err);
    res.status(500).json({ error: err.message });
  }
}
