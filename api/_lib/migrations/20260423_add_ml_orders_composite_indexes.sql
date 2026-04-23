-- P6: indexes compostos pra queries pesadas do dashboard/classifier.
-- Sprint 3 perfomance.

-- dashboard.js fetchStoredOrders filtra por connection_id + order_status + sale_date.
-- Índice simples de connection_id + sale_date já existia, mas o filtro adicional
-- por order_status faz o planner escanear. Composto cobre o caso comum.
CREATE INDEX IF NOT EXISTS idx_ml_orders_conn_status_date
  ON ml_orders(connection_id, order_status, sale_date DESC);

-- pack_id é extraído de raw_data (JSON) então não dá pra indexar direto.
-- Se futuramente expor pack_id como coluna, adicionar índice aqui.

-- shipping_id é usado pra lookup direto em fetchMLLiveChipBucketsDetailed
-- e em várias queries de sync/conferencia.
CREATE INDEX IF NOT EXISTS idx_ml_orders_shipping_id
  ON ml_orders(shipping_id) WHERE shipping_id IS NOT NULL;

-- SKU usado na cruzamento com ml_stock (getSalesAggregatesByKey).
-- Partial index economiza espaço ignorando NULLs.
CREATE INDEX IF NOT EXISTS idx_ml_orders_sku_date
  ON ml_orders(sku, sale_date) WHERE sku IS NOT NULL;

-- item_id usado em cruzamento também.
CREATE INDEX IF NOT EXISTS idx_ml_orders_item_id_date
  ON ml_orders(item_id, sale_date) WHERE item_id IS NOT NULL;
