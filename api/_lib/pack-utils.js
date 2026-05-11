/**
 * pack-utils.js — Utilitários compartilhados para agrupamento por pack.
 *
 * Usado tanto pelo dashboard.js (chips) quanto pelo orders.js (grid) para
 * garantir que a chave de agrupamento seja idêntica em ambos os módulos.
 *
 * Regra de chave (espelha o Mercado Livre Seller Center):
 *   pack_id  →  shipping_id  →  order_id
 *
 * Um "pack" no ML é um envio único que pode conter múltiplos pedidos.
 * O Seller Center conta ENVIOS (packs), não pedidos individuais.
 */

/**
 * Resolve a chave de pack para um row do banco de dados (ml_orders).
 *
 * @param {object} row - Row da tabela ml_orders com raw_data já parseado.
 * @returns {string} - Chave única do pack (pack_id | shipping_id | order_id).
 */
export function resolvePackKeyFromRow(row) {
  const rawData =
    row?.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};

  const packId = rawData.pack_id ? String(rawData.pack_id).trim() : null;
  const shipmentId =
    rawData.shipment_snapshot?.id ||
    rawData.shipping_id ||
    row?.shipping_id
      ? String(
          rawData.shipment_snapshot?.id ||
            rawData.shipping_id ||
            row?.shipping_id
        ).trim()
      : null;
  const orderId = row?.order_id ? String(row.order_id).trim() : null;

  return packId || shipmentId || orderId || "";
}

/**
 * Resolve a chave de pack para um objeto de pedido da API ML (live).
 *
 * @param {object} order - Objeto de pedido retornado pela API ML.
 * @returns {string} - Chave única do pack.
 */
export function resolvePackKeyFromApiOrder(order) {
  const packId = order?.pack_id ? String(order.pack_id).trim() : null;
  const shipmentId = order?.shipping?.id
    ? String(order.shipping.id).trim()
    : null;
  const orderId = order?.id ? String(order.id).trim() : null;

  return packId || shipmentId || orderId || "";
}

/**
 * Agrupa rows do banco em packs, preservando todos os pedidos do pack.
 *
 * Diferente do consolidateOrders (que agrupa por order_id para NF-e),
 * esta função agrupa por pack_id para fins de contagem operacional —
 * espelhando a semântica do Mercado Livre Seller Center.
 *
 * Retorna um Map<packKey, { packKey, orderIds, rows, primaryRow }>.
 *
 * @param {Array} rows - Rows da tabela ml_orders com raw_data parseado.
 * @returns {Map<string, object>} - Mapa de packs.
 */
export function groupRowsIntoPacks(rows) {
  const packs = new Map();

  if (!Array.isArray(rows)) return packs;

  for (const row of rows) {
    const key = resolvePackKeyFromRow(row);
    if (!key) continue;

    if (!packs.has(key)) {
      packs.set(key, {
        packKey: key,
        orderIds: [],
        rows: [],
        primaryRow: row, // primeiro pedido do pack (para dados de exibição)
      });
    }

    const pack = packs.get(key);
    pack.orderIds.push(String(row.order_id ?? ""));
    pack.rows.push(row);
  }

  return packs;
}

/**
 * Conta o número de packs únicos em um array de rows.
 * Equivalente ao que o Mercado Livre Seller Center mostra nos chips.
 *
 * @param {Array} rows - Rows da tabela ml_orders.
 * @returns {number} - Número de packs únicos.
 */
export function countUniquePacks(rows) {
  return groupRowsIntoPacks(rows).size;
}
