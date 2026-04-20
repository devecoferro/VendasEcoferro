// ─── Debug da classificacao de sub-status (validacao 1:1 com ML) ───────
//
// Roda o classifier server-side em todos os pedidos do banco e retorna:
//   - Contagem por (bucket × sub_status)
//   - Sample de 3 pedidos por sub_status com raw_data resumido
//
// Permite ao admin comparar visualmente "App diz X · ML diz Y" classe
// por classe, identificar divergencias e ajustar regras com base em
// dados reais (nao em chute).
//
// Endpoints:
//   GET /api/ml/admin/classify-debug              JSON
//   GET /api/ml/admin/classify-debug?format=html  HTML standalone
//   GET /api/ml/admin/classify-debug?bucket=upcoming  filtra so 1 bucket
//   GET /api/ml/admin/classify-debug?store=outros|full|all  filtra por store
//
// Read-only no banco. Apenas admin (requireAdmin).

import { db } from "../../_lib/db.js";
import { requireAdmin } from "../../_lib/auth-server.js";
import {
  getOrderSubstatus,
  SUBSTATUS_LABELS,
} from "../_lib/sub-status-classifier.js";

const BUCKETS = ["today", "upcoming", "in_transit", "finalized"];

const DASHBOARD_ACTIVE_STATUSES = [
  "pending", "handling", "ready_to_ship", "confirmed", "paid",
  "shipped", "in_transit", "delivered", "not_delivered", "returned", "cancelled",
];

function loadOrders() {
  const placeholders = DASHBOARD_ACTIVE_STATUSES.map(() => "?").join(",");
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Carrega pedidos recentes — janela suficiente pra cobrir todos os buckets
  const rows = db
    .prepare(
      `SELECT id, order_id, sale_number, sale_date, item_title, sku, quantity,
              order_status, raw_data, label_printed_at
       FROM ml_orders
       WHERE lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, ''))
             IN (${placeholders})
         AND (
           lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, '')) != 'delivered'
           OR sale_date > ?
         )`
    )
    .all(...DASHBOARD_ACTIVE_STATUSES, cutoff);

  return rows.map((row) => {
    let rawData = {};
    try {
      rawData = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data || {};
    } catch {
      rawData = {};
    }
    return { ...row, raw_data: rawData };
  });
}

function getStoreKey(order) {
  const ship = (order.raw_data || {}).shipment_snapshot || {};
  if (String(ship.logistic_type || "").toLowerCase() === "fulfillment") return "full";
  return "outros";
}

function summarizeRaw(order) {
  const raw = order.raw_data || {};
  const ship = raw.shipment_snapshot || {};
  return {
    order_id: order.order_id,
    sale_number: order.sale_number,
    sale_date: order.sale_date,
    item_title: order.item_title?.slice(0, 60) || null,
    sku: order.sku,
    quantity: order.quantity,
    order_status: order.order_status || raw.status,
    shipment_status: ship.status,
    shipment_substatus: ship.substatus,
    logistic_type: ship.logistic_type,
    shipping_option_name: (ship.shipping_option || {}).name,
    pack_id: raw.pack_id,
    tags: raw.tags,
    date_closed: raw.date_closed,
    date_first_printed: ship.date_first_printed,
    pickup_date: ship.pickup_date,
    estimated_delivery: ship.estimated_delivery_limit,
    nfe_emitted: raw.__nfe_emitted === true,
  };
}

function buildReport(filterBucket, filterStore) {
  const allOrders = loadOrders();
  const total = allOrders.length;

  const bucketsToReport = filterBucket
    ? [filterBucket]
    : BUCKETS;

  const filtered = filterStore && filterStore !== "all"
    ? allOrders.filter((o) => getStoreKey(o) === filterStore)
    : allOrders;

  const buckets = {};
  for (const bucket of bucketsToReport) {
    const counts = {};
    const samples = {};
    const orphans = [];

    for (const order of filtered) {
      const sub = getOrderSubstatus(order, bucket);
      if (!sub) {
        if (orphans.length < 3) orphans.push(summarizeRaw(order));
        continue;
      }
      counts[sub] = (counts[sub] || 0) + 1;
      if (!samples[sub]) samples[sub] = [];
      if (samples[sub].length < 3) samples[sub].push(summarizeRaw(order));
    }

    const total_in_bucket = Object.values(counts).reduce((a, b) => a + b, 0);
    buckets[bucket] = {
      total: total_in_bucket,
      counts: Object.fromEntries(
        Object.entries(counts).sort((a, b) => b[1] - a[1])
      ),
      samples,
      orphans_count: orphans.length,
      orphans_sample: orphans,
    };
  }

  return {
    generated_at: new Date().toISOString(),
    total_orders_loaded: total,
    filtered_orders: filtered.length,
    filter_store: filterStore || "all",
    buckets,
  };
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report) {
  const bucketSections = Object.entries(report.buckets)
    .map(([bucket, data]) => {
      const countsRows = Object.entries(data.counts)
        .map(([sub, count]) => {
          const label = SUBSTATUS_LABELS[sub] || sub;
          const samplesHtml = (data.samples[sub] || [])
            .map(
              (s) => `<details>
              <summary><code>${escapeHtml(s.order_id)}</code> — ${escapeHtml(s.item_title || "—")}</summary>
              <pre>${escapeHtml(JSON.stringify(s, null, 2))}</pre>
            </details>`
            )
            .join("");
          return `<tr>
            <td>${escapeHtml(label)}</td>
            <td><code>${escapeHtml(sub)}</code></td>
            <td class="num">${count}</td>
            <td>${samplesHtml}</td>
          </tr>`;
        })
        .join("");

      const orphansHtml =
        data.orphans_count > 0
          ? `<details class="orphans">
            <summary>⚠ ${data.orphans_count} pedido(s) NAO classificado(s)</summary>
            <pre>${escapeHtml(JSON.stringify(data.orphans_sample, null, 2))}</pre>
          </details>`
          : "";

      return `
      <section>
        <h2>${escapeHtml(bucket.toUpperCase())} — total: ${data.total}</h2>
        <table>
          <thead>
            <tr><th>Sub-status</th><th>Chave</th><th>Count</th><th>Amostras (clica pra ver raw_data)</th></tr>
          </thead>
          <tbody>${countsRows || `<tr><td colspan="4" class="empty">Nenhum pedido neste bucket</td></tr>`}</tbody>
        </table>
        ${orphansHtml}
      </section>
    `;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Debug — Classificação de Sub-Status</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#f5f5f7;color:#1a1a1a;padding:24px;max-width:1280px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:24px 0 8px;padding:8px 12px;background:#333;color:#fff;border-radius:6px}
  .meta{color:#666;font-size:13px;margin-bottom:16px}
  .filters{margin-bottom:20px;padding:12px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;font-size:13px}
  .filters a{color:#3483fa;text-decoration:none;margin-right:12px;padding:4px 8px;border-radius:4px}
  .filters a:hover{background:#eef4ff}
  .filters a.active{background:#fff159;color:#333;font-weight:600}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e5e5;border-radius:6px;overflow:hidden}
  th,td{padding:8px 12px;text-align:left;font-size:13px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  th{background:#f9f9fb;font-weight:600;text-transform:uppercase;font-size:11px;color:#666}
  td.num{text-align:right;font-family:ui-monospace,monospace;font-weight:bold;color:#3483fa}
  td.empty{text-align:center;color:#999;font-style:italic}
  details{margin:4px 0;font-size:11px}
  details summary{cursor:pointer;color:#3483fa}
  details pre{background:#f9f9fb;padding:8px;border-radius:4px;overflow-x:auto;font-size:10px;line-height:1.4;max-height:300px;overflow-y:auto}
  code{background:#f0f0f5;padding:1px 5px;border-radius:3px;font-size:11px}
  .orphans{margin-top:8px;padding:8px;background:#fff8e1;border:1px solid #fde68a;border-radius:6px}
  .orphans summary{color:#92400e;font-weight:600}
</style>
</head>
<body>
  <h1>🔍 Debug — Classificação de Sub-Status</h1>
  <div class="meta">
    Gerado em ${escapeHtml(new Date(report.generated_at).toLocaleString("pt-BR"))}
    · ${report.filtered_orders} pedidos analisados
    · ${report.total_orders_loaded} no banco
    · loja: <strong>${escapeHtml(report.filter_store)}</strong>
  </div>

  <div class="filters">
    <strong>Loja:</strong>
    <a href="?format=html&store=all" class="${report.filter_store === "all" ? "active" : ""}">Todas</a>
    <a href="?format=html&store=outros" class="${report.filter_store === "outros" ? "active" : ""}">Outros (Ourinhos)</a>
    <a href="?format=html&store=full" class="${report.filter_store === "full" ? "active" : ""}">Full</a>
  </div>

  ${bucketSections}

  <p style="margin-top:32px;color:#888;font-size:11px">
    Cada amostra inclui campos chave do raw_data (shipment.status, substatus, logistic_type, tags, etc).
    Use isso pra validar contra o Mercado Livre Seller Center e me passar quais classes precisam ajuste.
  </p>
</body>
</html>`;
}

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Acesso negado." });
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ success: false, error: "Use GET." });
  }

  try {
    const filterBucket = request.query?.bucket
      ? String(request.query.bucket).toLowerCase()
      : null;
    const filterStore = request.query?.store
      ? String(request.query.store).toLowerCase()
      : null;

    if (filterBucket && !BUCKETS.includes(filterBucket)) {
      return response.status(400).json({
        success: false,
        error: `bucket invalido. Use um de: ${BUCKETS.join(", ")}`,
      });
    }

    const report = buildReport(filterBucket, filterStore);

    if (String(request.query?.format || "json").toLowerCase() === "html") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.status(200).send(renderHtml(report));
    }

    return response.status(200).json({ success: true, ...report });
  } catch (error) {
    console.error("[classify-debug] Falha:", error);
    return response.status(500).json({
      success: false,
      error: error?.message || "Falha ao gerar debug.",
    });
  }
}
