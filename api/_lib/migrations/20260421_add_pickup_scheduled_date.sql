-- Rastreia quando a coleta está agendada pelo ML pra esse pedido.
-- Vem de GET /shipments/{id} → lead_time.estimated_schedule_limit.date.
-- null = coleta ainda não agendada (ML só agenda após etiqueta pronta).
--
-- Usado pelo ColetasPanel pra agrupar orders por data real de coleta
-- (Amanhã / A partir de [data]), espelhando como o ML Seller Center
-- organiza "Próximos dias". Antes dependíamos de regex no status_text
-- do scraping — frágil e só cobria ~22% dos orders. Agora vem direto
-- da API oficial do ML, cobertura 100%.

ALTER TABLE ml_orders ADD COLUMN pickup_scheduled_date TEXT;

CREATE INDEX IF NOT EXISTS idx_ml_orders_pickup_scheduled_date
  ON ml_orders(pickup_scheduled_date);
