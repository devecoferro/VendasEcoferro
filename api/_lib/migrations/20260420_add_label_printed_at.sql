-- Rastreia quando a etiqueta de um pedido foi impressa pela ultima vez.
-- null = etiqueta nunca foi impressa (pedido "pendente de impressao").
-- ISO-8601 string UTC quando foi impressa, para permitir filtros/ordenacao
-- estaveis e sem depender de locale.
--
-- O operador usa isso para:
--   - Filtrar "pedidos sem etiqueta impressa" (o que falta imprimir hoje)
--   - Filtrar "pedidos com etiqueta impressa" (auditoria de ja feitos)
--   - Evitar reimpressao acidental ao gerar lote de etiquetas.

ALTER TABLE ml_orders ADD COLUMN label_printed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ml_orders_label_printed_at
  ON ml_orders(label_printed_at);
