function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeOrderItem(row) {
  return {
    item_title: row?.item_title ?? null,
    sku: row?.sku ?? null,
    quantity: toFiniteNumber(row?.quantity, 0),
    amount: row?.amount == null ? null : toFiniteNumber(row.amount, 0),
    item_id: row?.item_id ?? null,
    product_image_url: row?.product_image_url ?? null,
  };
}

function buildOrderTitle(items) {
  const titledItems = items
    .map((item) => item.item_title)
    .filter((title) => typeof title === "string" && title.trim().length > 0);

  if (titledItems.length === 0) {
    return null;
  }

  if (titledItems.length === 1) {
    return titledItems[0];
  }

  return `${titledItems[0]} + ${titledItems.length - 1} item(ns)`;
}

function buildOrderSku(items) {
  const uniqueSkus = [...new Set(items.map((item) => item.sku).filter(Boolean))];

  if (uniqueSkus.length === 0) {
    return null;
  }

  return uniqueSkus[0];
}

export function consolidateOrders(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const groupedOrders = new Map();

  for (const row of rows) {
    const orderId = String(row?.order_id ?? "").trim();
    if (!orderId) {
      continue;
    }

    const item = normalizeOrderItem(row);
    const existingOrder = groupedOrders.get(orderId);

    if (existingOrder) {
      existingOrder.items.push(item);
      existingOrder.quantity += item.quantity;
      // Use integer cents arithmetic to avoid floating-point drift when summing items
      existingOrder.amountCents += Math.round((item.amount ?? 0) * 100);
      continue;
    }

    groupedOrders.set(orderId, {
      id: row.id,
      order_id: orderId,
      sale_number: row.sale_number ?? orderId,
      sale_date: row.sale_date ?? null,
      buyer_name: row.buyer_name ?? null,
      buyer_nickname: row.buyer_nickname ?? null,
      item_title: row.item_title ?? null,
      item_id: row.item_id ?? null,
      product_image_url: row.product_image_url ?? null,
      sku: row.sku ?? null,
      quantity: item.quantity,
      amount: item.amount ?? 0,
      // Track running total in integer cents to avoid floating-point drift
      amountCents: Math.round((item.amount ?? 0) * 100),
      order_status: row.order_status ?? null,
      raw_data:
        row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {},
      items: [item],
    });
  }

  return Array.from(groupedOrders.values()).map((order) => {
    const primaryItem =
      order.items.find((item) => item.product_image_url || item.item_title || item.sku) ||
      order.items[0];
    // Convert back from integer cents — precise to 2 decimal places, no floating-point drift
    const totalAmount = (order.amountCents ?? Math.round((order.amount || 0) * 100)) / 100;

    return {
      ...order,
      item_title: buildOrderTitle(order.items) ?? primaryItem?.item_title ?? order.item_title,
      item_id: primaryItem?.item_id ?? order.item_id,
      product_image_url: primaryItem?.product_image_url ?? order.product_image_url ?? null,
      sku: buildOrderSku(order.items) ?? primaryItem?.sku ?? order.sku,
      quantity: order.quantity,
      amount: totalAmount > 0 ? Number(totalAmount.toFixed(2)) : null,
      raw_data:
        order.raw_data && typeof order.raw_data === "object"
          ? {
              ...order.raw_data,
              grouped_items_count: order.items.length,
              grouped_quantity_total: order.quantity,
            }
          : order.raw_data,
    };
  });
}
