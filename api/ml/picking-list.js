// ─── Resumo Operacional de Separação (Picking List) ─────────────────────────
//
// MODELO DE OPERAÇÃO:
//
// 1. SEPARAÇÃO: Operador abre este endpoint → vê lista de produtos para separar
//    agrupados por SKU/título com quantidade total. Pega produtos na prateleira.
//
// 2. CONFERÊNCIA: Cada pedido aparece individualmente na seção "orders" para
//    conferir item por item antes de embalar.
//
// 3. NF-e: Gerar nota fiscal (endpoint /api/nfe/generate)
//
// 4. ETIQUETA ML: Imprimir etiqueta de envio (endpoint /api/ml/order-documents)
//
// 5. DESPACHO: Produto embalado + NF-e + etiqueta → pronto para coleta
//
// CRITÉRIO DE INCLUSÃO:
// - shipment_snapshot.status IN (ready_to_ship, handling)
// - order.status NOT IN (cancelled)
// - Exclui: shipped, delivered, cancelled, returned, not_delivered
//
// DEDUPLICAÇÃO:
// - Cada order_id aparece uma vez (mesmo que tenha múltiplos itens)
// - Packs (mesmo comprador, mesmo carrinho) são identificados mas NÃO fundidos
//   porque cada order_id tem sua própria NF-e e etiqueta.

import { db } from "../_lib/db.js";

/**
 * Busca pedidos que precisam de ação operacional AGORA.
 * Critério: shipment status = ready_to_ship ou handling, order não cancelado.
 */
function getActionableOrders() {
  const rows = db
    .prepare(
      `SELECT order_id, item_title, item_id, sku, quantity, product_image_url,
              buyer_name, buyer_nickname, shipping_id, sale_date, raw_data
       FROM ml_orders
       WHERE lower(COALESCE(json_extract(raw_data, '$.shipment_snapshot.status'), order_status, ''))
             IN ('ready_to_ship', 'handling')
         AND lower(COALESCE(json_extract(raw_data, '$.status'), order_status, '')) NOT IN ('cancelled')
       ORDER BY sale_date ASC`
    )
    .all();

  // Filtro definitivo: só pedidos com shipment_snapshot confirmando status operacional
  return rows.filter((row) => {
    try {
      const raw = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data;
      const shipmentStatus = (raw?.shipment_snapshot?.status || "").toLowerCase();
      return shipmentStatus === "ready_to_ship" || shipmentStatus === "handling";
    } catch {
      return false;
    }
  });
}

/**
 * Agrupa itens por SKU/título normalizado para separação.
 * O operador usa esta lista para pegar os produtos na prateleira.
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

/**
 * Monta lista de pedidos individuais para conferência/embalagem.
 * Cada pedido = 1 pacote a despachar (com seus itens, comprador, status de docs).
 */
function buildOrdersList(orders) {
  // Agrupa por order_id (multi-item orders)
  const orderMap = new Map();

  for (const row of orders) {
    if (!orderMap.has(row.order_id)) {
      let raw;
      try {
        raw = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data;
      } catch {
        raw = {};
      }

      const shipment = raw?.shipment_snapshot || {};
      const substatus = (shipment.substatus || "").toLowerCase();
      const packId = raw?.pack_id || null;
      const shippingOption = shipment.shipping_option || {};

      orderMap.set(row.order_id, {
        order_id: row.order_id,
        pack_id: packId,
        buyer_name: row.buyer_name || row.buyer_nickname || "Comprador",
        sale_date: row.sale_date,
        shipping_id: row.shipping_id,
        substatus,
        logistic_type: (shipment.logistic_type || "").toLowerCase(),
        estimated_delivery: shippingOption.estimated_delivery_limit || shippingOption.estimated_delivery_final || null,
        items: [],
        // Status operacional para o fluxo
        needs_invoice: substatus === "invoice_pending",
        ready_for_label: substatus !== "invoice_pending",
      });
    }

    orderMap.get(row.order_id).items.push({
      title: (row.item_title || "").trim(),
      sku: row.sku || null,
      item_id: row.item_id || null,
      quantity: Number(row.quantity) || 1,
      image_url: row.product_image_url || null,
    });
  }

  // Ordenar: invoice_pending primeiro (precisa de ação), depois por data
  return Array.from(orderMap.values()).sort((a, b) => {
    if (a.needs_invoice && !b.needs_invoice) return -1;
    if (!a.needs_invoice && b.needs_invoice) return 1;
    return (a.sale_date || "").localeCompare(b.sale_date || "");
  });
}

export default function handler(request, response) {
  try {
    const actionableOrders = getActionableOrders();
    const pickingList = buildPickingList(actionableOrders);
    const ordersList = buildOrdersList(actionableOrders);

    const totalItems = pickingList.reduce((sum, item) => sum + item.quantity, 0);
    const totalProducts = pickingList.length;
    const uniqueOrders = new Set(actionableOrders.map((o) => o.order_id));
    const needsInvoice = ordersList.filter((o) => o.needs_invoice).length;
    const readyForLabel = ordersList.filter((o) => o.ready_for_label).length;

    return response.json({
      success: true,
      generated_at: new Date().toISOString(),
      // ─── Resumo ───────────────────────────────────────
      summary: {
        total_items_to_pick: totalItems,
        total_distinct_products: totalProducts,
        total_orders: uniqueOrders.size,
        needs_invoice: needsInvoice,
        ready_for_label: readyForLabel,
      },
      // ─── Lista de Separação (prateleira) ──────────────
      // Operador usa isso para pegar produtos. Agrupado por produto.
      picking: pickingList,
      // ─── Pedidos Individuais (conferência) ────────────
      // Após separar, operador confere pedido a pedido.
      orders: ordersList,
    });
  } catch (err) {
    return response.status(500).json({ success: false, error: err.message });
  }
}
