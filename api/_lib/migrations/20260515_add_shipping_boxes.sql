-- Migration: tabela de caixas de saída para conferência e relatório
-- Criada em 2026-05-15

CREATE TABLE IF NOT EXISTS shipping_boxes (
  id TEXT PRIMARY KEY,
  -- Identificação
  box_number TEXT NOT NULL,          -- Número sequencial da caixa (ex: "CX-001")
  connection_id TEXT NOT NULL,       -- FK para ml_connections (empresa: Ecoferro ou Fantom)
  seller_nickname TEXT NOT NULL,     -- Nome da empresa (snapshot para relatório)
  -- Conteúdo
  order_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array de order_ids incluídos na caixa
  order_count INTEGER NOT NULL DEFAULT 0, -- Quantidade de pedidos
  total_amount REAL NOT NULL DEFAULT 0,   -- Valor total dos pedidos na caixa
  -- Status da caixa
  status TEXT NOT NULL DEFAULT 'open'     -- 'open' | 'confirmed' | 'dispatched'
    CHECK (status IN ('open', 'confirmed', 'dispatched')),
  -- Rastreio e despacho
  tracking_code TEXT,                -- Código de rastreio (opcional)
  carrier TEXT,                      -- Transportadora (opcional)
  dispatch_date TEXT,                -- Data de despacho (ISO 8601)
  -- Observações
  notes TEXT,
  -- Auditoria
  created_by TEXT,                   -- user_id do operador
  confirmed_by TEXT,                 -- user_id do conferente
  confirmed_at TEXT,
  dispatched_by TEXT,
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES ml_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipping_boxes_connection_id
  ON shipping_boxes(connection_id);

CREATE INDEX IF NOT EXISTS idx_shipping_boxes_status
  ON shipping_boxes(status);

CREATE INDEX IF NOT EXISTS idx_shipping_boxes_created_at
  ON shipping_boxes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipping_boxes_dispatch_date
  ON shipping_boxes(dispatch_date DESC);
