-- Tabela de registros da Conferência de Saída
-- Cada linha = uma caixa lida pelo operador na tela de Conferência de Saída
CREATE TABLE IF NOT EXISTS conferencia_saida (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,                        -- ID da sessão de conferência (UUID gerado no frontend)
  session_date    TEXT    NOT NULL,                        -- Data da sessão (YYYY-MM-DD, fuso SP)
  shipping_id     TEXT    NOT NULL,                        -- ID do envio ML (shipment_id)
  order_id        TEXT,                                    -- ID do pedido ML (pode ser NULL se pack)
  sale_number     TEXT,                                    -- Número da venda (sale_number)
  pack_id         TEXT,                                    -- Pack ID (se múltiplos pedidos)
  connection_id   TEXT    NOT NULL,                        -- ID da conexão ML (identifica empresa)
  seller_nickname TEXT    NOT NULL,                        -- Nome da empresa (ECOFERRO, FANTOM 01, etc.)
  item_title      TEXT,                                    -- Título do produto
  buyer_name      TEXT,                                    -- Nome do comprador
  amount          REAL    DEFAULT 0,                       -- Valor do pedido
  order_count     INTEGER DEFAULT 1,                       -- Qtd de pedidos na caixa (pack)
  operator_id     TEXT,                                    -- ID do usuário que fez a leitura
  operator_name   TEXT,                                    -- Nome do operador
  read_at         TEXT    NOT NULL DEFAULT (datetime('now')), -- Data/hora da leitura (UTC)
  UNIQUE(session_id, shipping_id)                          -- Evita duplicata na mesma sessão
);

CREATE INDEX IF NOT EXISTS idx_conferencia_saida_session ON conferencia_saida(session_id);
CREATE INDEX IF NOT EXISTS idx_conferencia_saida_date ON conferencia_saida(session_date);
CREATE INDEX IF NOT EXISTS idx_conferencia_saida_connection ON conferencia_saida(connection_id);
CREATE INDEX IF NOT EXISTS idx_conferencia_saida_shipping ON conferencia_saida(shipping_id);
