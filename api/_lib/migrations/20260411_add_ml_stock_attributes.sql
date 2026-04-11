-- Adiciona colunas de marca, modelo e ano ao estoque ML.
-- Extraidos dos attributes do item na API do Mercado Livre.
ALTER TABLE ml_stock ADD COLUMN brand TEXT;
ALTER TABLE ml_stock ADD COLUMN model TEXT;
ALTER TABLE ml_stock ADD COLUMN vehicle_year TEXT;
