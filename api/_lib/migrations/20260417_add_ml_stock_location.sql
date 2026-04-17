-- Adiciona campos de localização no depósito para rastreamento físico dos produtos.
-- Corredor (A, B, C...), Estante (1, 2, 3...), Nível (1, 2, 3...)
-- Permite ao operador encontrar rapidamente o produto na separação.

ALTER TABLE ml_stock ADD COLUMN location_corridor TEXT;
ALTER TABLE ml_stock ADD COLUMN location_shelf TEXT;
ALTER TABLE ml_stock ADD COLUMN location_level TEXT;
ALTER TABLE ml_stock ADD COLUMN location_notes TEXT;
