// Resumo de Produtos para Separação (Picking List)
// Agrupa itens de pedidos acionáveis por título/SKU e soma quantidades.
import { getOrderSummariesByScope } from "./_lib/storage.js";
import { db } from "../_lib/db.js";

/**
 * Retorna pedidos operacionais que precisam de ação do vendedor HOJE:
 * - ready_to_ship (qualquer substatus)
 * - handling
 * Exclui: shipped, delivered, cancelled, returned, not_delivered
 */
function getActionableOrders() {
  const actionableStatuses = new Set([
    "ready_to_ship",
    "handling",
  ]);

  // Busca TODOS os registros (não agrupados) para ter acesso a item_title e quantity
  const rows = db
    .prepare(
      `SELECT order_id, item_title, item_id, sku, quantity, product_image_url, raw_data
       FROM ml_orders
       WHERE lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, ''))
             IN ('ready_to_ship', 'handling')
         AND lower(COALESCE(json_extract(raw_data, '$.status'), order_status, '')) NOT IN ('cancelled')
       ORDER BY item_title`
    )
    .all();

  // Filtrar: excluir pedidos cujo shipment já foi enviado/finalizado
  return rows.filter((row) => {
    try {
      const raw = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data;
      const shipmentStatus = (raw?.shipment_snapshot?.status || "").toLowerCase();
      return actionableStatuses.has(shipmentStatus);
    } catch {
      return false;
    }
  });
}

/**
 * Agrupa itens por título normalizado, soma quantidades.
 */
function buildPickingList(orders) {
  const groupMap = new Map();

  for (const row of orders) {
    const title = (row.item_title || "Produto sem título").trim();
    const qty = Number(row.quantity) || 1;
    const key = (row.sku || title).toLowerCase().trim();

    if (groupMap.has(key)) {
      const entry = groupMap.get(key);
      entry.quantity += qty;
      entry.order_ids.add(row.order_id);
    } else {
      groupMap.set(key, {
        title,
        sku: row.sku || null,
        item_id: row.item_id || null,
        image_url: row.product_image_url || null,
        quantity: qty,
        order_ids: new Set([row.order_id]),
      });
    }
  }

  // Converter para array e ordenar por quantidade (maior primeiro)
  return Array.from(groupMap.values())
    .map((entry) => ({
      title: entry.title,
      sku: entry.sku,
      item_id: entry.item_id,
      image_url: entry.image_url,
      quantity: entry.quantity,
      order_count: entry.order_ids.size,
    }))
    .sort((a, b) => b.quantity - a.quantity);
}

export default function handler(request, response) {
  try {
    const actionableOrders = getActionableOrders();
    const pickingList = buildPickingList(actionableOrders);

    const totalItems = pickingList.reduce((sum, item) => sum + item.quantity, 0);
    const totalProducts = pickingList.length;

    return response.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_items: totalItems,
      total_distinct_products: totalProducts,
      total_orders: new Set(actionableOrders.map((o) => o.order_id)).size,
      items: pickingList,
    });
  } catch (err) {
    return response.status(500).json({ success: false, error: err.message });
  }
}
