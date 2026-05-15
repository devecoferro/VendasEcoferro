/**
 * box-report.js — Relatório de caixas despachadas (leitura pura dos pedidos ML)
 *
 * Lógica:
 *  - "Caixa" = 1 envio físico = 1 shipping_id único
 *  - Quando pack_id existe, vários pedidos compartilham a mesma caixa
 *  - date_shipped = data em que a caixa saiu (coletada pelo transportador)
 *  - Agrupamos por shipping_id para não contar a mesma caixa duas vezes
 *    quando há múltiplos pedidos no mesmo pack
 *
 * Endpoints:
 *  GET /api/ml/box-report/summary   — totais gerais + por empresa
 *  GET /api/ml/box-report/daily     — série diária de caixas despachadas
 *  GET /api/ml/box-report/list      — lista detalhada de caixas (paginada)
 *
 * Query params comuns:
 *  date_from  YYYY-MM-DD  (padrão: 30 dias atrás)
 *  date_to    YYYY-MM-DD  (padrão: hoje)
 *  connection_id  filtra por empresa específica
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

  const dateFrom = query.date_from || thirtyAgoStr;
  const dateTo = query.date_to || todayStr;
  return { dateFrom, dateTo };
}

/**
 * Retorna o nickname da empresa a partir do connection_id.
 * Usa a tabela ml_connections.
 */
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

/**
 * Query base: retorna 1 linha por shipping_id único (deduplicada por pack).
 * Usa date_shipped do status_history para determinar quando a caixa saiu.
 * Fallback: updated_at quando date_shipped é NULL.
 */
function buildBaseQuery(dateFrom, dateTo, connectionId) {
  const connFilter = connectionId ? `AND connection_id = '${connectionId}'` : "";

  return `
    SELECT
      connection_id,
      shipping_id,
      -- Data de despacho: preferir date_shipped do histórico, fallback updated_at
      COALESCE(
        json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped'),
        updated_at
      ) AS shipped_at,
      -- Subtatus atual
      json_extract(raw_data, '$.shipment_snapshot.substatus') AS substatus,
      -- pack_id para identificar caixas com múltiplos pedidos
      json_extract(raw_data, '$.pack_id') AS pack_id,
      -- Contagem de pedidos nesta caixa (pelo pack_id ou 1 se sem pack)
      COUNT(*) AS order_count,
      -- Faturamento total da caixa
      SUM(amount) AS total_amount,
      -- Logistic type
      json_extract(raw_data, '$.shipment_snapshot.shipping_option.shipping_method_type') AS logistic_type
    FROM ml_orders
    WHERE
      json_extract(raw_data, '$.shipment_snapshot.status') = 'shipped'
      ${connFilter}
      AND DATE(
        COALESCE(
          json_extract(raw_data, '$.shipment_snapshot.status_history.date_shipped'),
          updated_at
        )
      ) BETWEEN '${dateFrom}' AND '${dateTo}'
    GROUP BY shipping_id
    ORDER BY shipped_at DESC
  `;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * GET /api/ml/box-report/summary
 * Retorna totais gerais e por empresa.
 */
export async function handleSummary(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const companyMap = getCompanyMap();

  try {
    const rows = db.prepare(buildBaseQuery(dateFrom, dateTo, connection_id)).all();

    // Totais gerais
    const totalBoxes = rows.length;
    const totalOrders = rows.reduce((s, r) => s + r.order_count, 0);
    const totalAmount = rows.reduce((s, r) => s + (r.total_amount || 0), 0);

    // Por empresa
    const byCompany = {};
    for (const r of rows) {
      const cid = r.connection_id;
      if (!byCompany[cid]) {
        byCompany[cid] = {
          connection_id: cid,
          seller_nickname: companyMap[cid] || cid,
          total_boxes: 0,
          total_orders: 0,
          total_amount: 0,
        };
      }
      byCompany[cid].total_boxes += 1;
      byCompany[cid].total_orders += r.order_count;
      byCompany[cid].total_amount += r.total_amount || 0;
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
 * Retorna série diária: data → { total_boxes, total_orders, total_amount, by_company }
 */
export async function handleDaily(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const companyMap = getCompanyMap();

  try {
    const rows = db.prepare(buildBaseQuery(dateFrom, dateTo, connection_id)).all();

    // Agrupar por dia
    const byDay = {};
    for (const r of rows) {
      const day = r.shipped_at ? r.shipped_at.slice(0, 10) : "unknown";
      if (!byDay[day]) {
        byDay[day] = {
          date: day,
          total_boxes: 0,
          total_orders: 0,
          total_amount: 0,
          by_company: {},
        };
      }
      byDay[day].total_boxes += 1;
      byDay[day].total_orders += r.order_count;
      byDay[day].total_amount += r.total_amount || 0;

      const nick = companyMap[r.connection_id] || r.connection_id;
      if (!byDay[day].by_company[nick]) {
        byDay[day].by_company[nick] = { boxes: 0, orders: 0, amount: 0 };
      }
      byDay[day].by_company[nick].boxes += 1;
      byDay[day].by_company[nick].orders += r.order_count;
      byDay[day].by_company[nick].amount += r.total_amount || 0;
    }

    // Converter para array ordenado por data
    const series = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ date_from: dateFrom, date_to: dateTo, series });
  } catch (err) {
    console.error("[box-report] daily error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/ml/box-report/list
 * Lista detalhada de caixas despachadas (paginada).
 */
export async function handleList(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const { dateFrom, dateTo } = parseDateRange(req.query);
  const { connection_id } = req.query;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(200, parseInt(req.query.limit || "50", 10));
  const offset = (page - 1) * limit;
  const companyMap = getCompanyMap();

  try {
    const allRows = db.prepare(buildBaseQuery(dateFrom, dateTo, connection_id)).all();
    const total = allRows.length;
    const rows = allRows.slice(offset, offset + limit);

    const items = rows.map((r) => ({
      shipping_id: r.shipping_id,
      seller_nickname: companyMap[r.connection_id] || r.connection_id,
      connection_id: r.connection_id,
      shipped_at: r.shipped_at,
      order_count: r.order_count,
      total_amount: r.total_amount || 0,
      pack_id: r.pack_id,
      substatus: r.substatus,
      logistic_type: r.logistic_type,
    }));

    res.json({
      date_from: dateFrom,
      date_to: dateTo,
      total,
      page,
      limit,
      items,
    });
  } catch (err) {
    console.error("[box-report] list error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/ml/box-report/lookup?q=SALE_NUMBER_OR_PACK_ID
 * Busca um pedido pelo sale_number ou pack_id lido no QR Code.
 * Retorna os dados do pedido + empresa identificada.
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

    // Se veio do QR do ML (shipping_id), busca diretamente por shipping_id
    if (isShippingIdLookup) {
      rows = db.prepare(
        `SELECT sale_number, order_id, connection_id, buyer_name, item_title, sku, amount, quantity,
                json_extract(raw_data, '$.pack_id') AS pack_id,
                json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
                shipping_id, sale_date
         FROM ml_orders WHERE shipping_id = ?`
      ).all(q);
    }

    // Fallback: tenta por sale_number / order_id
    if (rows.length === 0) {
      rows = db.prepare(
        `SELECT sale_number, order_id, connection_id, buyer_name, item_title, sku, amount, quantity,
                json_extract(raw_data, '$.pack_id') AS pack_id,
                json_extract(raw_data, '$.shipment_snapshot.status') AS ship_status,
                shipping_id, sale_date
         FROM ml_orders WHERE sale_number = ? OR order_id = ?`
      ).all(q, q);
    }

    // Fallback: tenta por pack_id
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

    // Monta resultado — pode ser 1 pedido ou múltiplos (pack)
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

/**
 * GET /api/ml/box-report/today
 * Visão do dia atual — caixas que saíram hoje, separadas por empresa.
 */
export async function handleToday(req, res) {
  try {
    await requireAuthenticatedProfile(req);
  } catch {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  const today = new Date().toISOString().slice(0, 10);
  const companyMap = getCompanyMap();

  try {
    const rows = db.prepare(buildBaseQuery(today, today, null)).all();

    const byCompany = {};
    for (const r of rows) {
      const cid = r.connection_id;
      if (!byCompany[cid]) {
        byCompany[cid] = {
          connection_id: cid,
          seller_nickname: companyMap[cid] || cid,
          boxes: [],
          total_boxes: 0,
          total_orders: 0,
          total_amount: 0,
        };
      }
      byCompany[cid].boxes.push({
        shipping_id: r.shipping_id,
        shipped_at: r.shipped_at,
        order_count: r.order_count,
        total_amount: r.total_amount || 0,
        pack_id: r.pack_id,
        substatus: r.substatus,
        logistic_type: r.logistic_type,
      });
      byCompany[cid].total_boxes += 1;
      byCompany[cid].total_orders += r.order_count;
      byCompany[cid].total_amount += r.total_amount || 0;
    }

    res.json({
      date: today,
      total_boxes: rows.length,
      total_orders: rows.reduce((s, r) => s + r.order_count, 0),
      total_amount: rows.reduce((s, r) => s + (r.total_amount || 0), 0),
      by_company: Object.values(byCompany),
    });
  } catch (err) {
    console.error("[box-report] today error:", err);
    res.status(500).json({ error: err.message });
  }
}
