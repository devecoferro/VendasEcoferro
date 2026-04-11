# EcoFerro - Vendas Mercado Livre

## Visao Geral
Sistema de gestao de vendas integrado ao Mercado Livre para a ECOFERRO (seller_id: 75043688).
Stack: React (Vite) + Express + SQLite (better-sqlite3). Deploy: Docker em VPS Coolify.

## Arquitetura

### Frontend (src/)
- **React + TypeScript + Vite** com ShadCN/Radix UI
- Pagina principal: `src/pages/MercadoLivrePage.tsx` — lista operacional de pedidos
- Dashboard: `src/pages/DashboardPage.tsx` — visao executiva
- Etiquetas: `src/services/pdfExportService.ts` — gera PDF com foto, QR code, SKU
- Review: `src/pages/ReviewPage.tsx` — conferencia antes de gerar etiqueta

### Backend (api/)
- **Express** servido por `server/index.js`
- Rotas em `api/ml/` para Mercado Livre, `api/nfe/` para Nota Fiscal
- Auth: sessoes com hash scrypt em `app_sessions`, cookie `ecoferro_session`
- DB: SQLite em `/app/data/ecoferro.db`

### Sync com Mercado Livre (api/ml/sync.js)
- **Auto-sync**: roda automaticamente a cada 30 segundos via `setInterval` no server/index.js
- **Cooldown interno**: 2 minutos (INCREMENTAL_SYNC_COOLDOWN_MS) — syncs frequentes sao ignorados
- **Incremental**: usa `updated_from` (last_sync_at) para buscar apenas pedidos alterados
- **Completo**: ate 200 paginas (10.000 pedidos) quando sem filtro de data
- **Deduplicacao**: `syncRequestsInFlight` Map previne syncs concorrentes
- **Token refresh**: OAuth2 com client_credentials. Token dura ~6h, refresh automatico via `ensureValidAccessToken()`
- **Env vars necessarias**: `ML_CLIENT_ID`, `ML_CLIENT_SECRET` no container Docker

### Classificacao Operacional (api/ml/dashboard.js)
O dashboard classifica pedidos nos mesmos buckets do ML Seller Center:

#### Buckets:
1. **Envios de hoje** (`today`):
   - Cross-docking: `ready_for_pickup` ou SLA <= hoje
   - Fulfillment: `ready_to_pack` (ML preparando) ou `in_warehouse` com SLA <= hoje
2. **Proximos dias** (`upcoming`):
   - `invoice_pending`, `in_packing_list`, `in_hub`, `packed`
   - Fulfillment `in_warehouse` com SLA > hoje
3. **Em transito** (`in_transit`):
   - `shipped` com substatus: `out_for_delivery`, `receiver_absent`, `not_visited`, `at_customs`
   - `not_delivered` com substatus ativo: `returning_to_sender`, `returning_to_hub`, `delayed`, `return_failed`
   - `shipped/waiting_for_withdrawal` NAO e em transito (pacote no ponto de retirada = finalizado para vendedor)
4. **Finalizadas** (`finalized`):
   - `cancelled`, `returned`
   - `not_delivered` sem substatus ativo (perdido, etc.)
   - Janela: apenas ultimos 2 dias (usa data_cancelled/date_not_delivered/date_returned, nao sale_date)

#### Filtros:
- **Freshness (stale)**: paid/pending/confirmed 14d, ready_to_ship 30d, shipped/in_transit 45d
- **Pack dedup**: global por `bucket:packId` — mesmo pack nao conta 2x
- **Depositos**: Fulfillment agrupado como "Full", cross_docking por loja

### Emissao de NF-e (api/nfe/)
- `api/nfe/generate.js` — handler HTTP
- `api/nfe/mercado-livre-faturador.js` — logica principal (13k+ linhas)
- Validacoes: pagamento aprovado, `ready_to_ship`, `invoice_pending`, billing_info completo
- Gera XML + DANFE, sincroniza com endpoint faturador do ML
- `api/nfe/sync-mercadolivre.js` — sincroniza status de NF-e com ML

### Etiqueta Interna (src/services/pdfExportService.ts)
- PDF A4 com 5 etiquetas por pagina
- Cada etiqueta tem: foto do produto, SKU, nome, comprador, nickname, numero da venda, QR codes
- Foto vem de `product_image_url` (armazenada na tabela ml_orders, URL do ML CDN)
- Observacoes customizadas por etiqueta
- Logo EcoFerro no canto
- **IMPORTANTE**: a view `dashboard` dos pedidos DEVE incluir `product_image_url` e `items` para que as etiquetas funcionem

### Etiqueta de Envio ML
- Etiqueta oficial do Mercado Livre para colagem no pacote
- Baixada via API ML: `/shipments/{id}/label` (ZPL) ou via link no shipment
- Diferente da etiqueta interna EcoFerro (que e para controle/conferencia)

## Deploy

### VPS
- IP: 77.37.69.102
- Container: `vendas-ecoferro-vps`
- Network: coolify
- Volume: `/data/vendas-ecoferro-vps/data:/app/data`
- Source: `/data/coolify/applications/m1b5cfm30arif8y7bia20bwo/source`

### Build e Deploy
```bash
# Build frontend
npm run build

# Atualizar no VPS
git push origin main
ssh root@77.37.69.102 "cd /data/coolify/.../source && git pull"
ssh root@77.37.69.102 "docker cp source/api/ml/dashboard.js vendas-ecoferro-vps:/app/api/ml/dashboard.js"
ssh root@77.37.69.102 "docker restart vendas-ecoferro-vps"
```

### Docker run (referencia)
```bash
docker run -d --name vendas-ecoferro-vps \
  --network coolify \
  -v /data/vendas-ecoferro-vps/data:/app/data \
  -e ML_CLIENT_ID=... \
  -e ML_CLIENT_SECRET=... \
  vendas-ecoferro-new:latest
```

## Banco de Dados (SQLite)

### Tabelas principais:
- `ml_orders` — pedidos ML com raw_data JSON completo
  - Colunas: id, order_id, sale_number, sale_date, buyer_name, buyer_nickname, item_title, item_id, product_image_url, sku, quantity, amount, shipping_id, order_status, raw_data
  - raw_data contem: shipment_snapshot (status, substatus, status_history, shipping_option, logistic_type), deposit_snapshot (key, label, logistic_type), sla_snapshot (expected_date), billing_info_snapshot, pack_id, payments
- `ml_connections` — credenciais OAuth ML (access_token, refresh_token, seller_id, etc.)
- `app_user_profiles` — usuarios do sistema
- `app_sessions` — sessoes ativas (token_hash, expires_at)
- `ml_stock` — estoque de itens ML com thumbnail
- `nfe_documents` — notas fiscais emitidas

## Problemas Conhecidos e Solucoes

### Sync lag
- O ML Seller Center mostra dados em tempo real. Nosso dashboard mostra dados do ultimo sync.
- Com auto-sync a cada 30s, o lag maximo e ~30s + tempo do sync (~5-15s).
- Diferenca de ~3-5 pedidos e normal entre syncs.

### Pack deduplication
- ML Seller Center conta ENVIOS (shipments), nao pedidos.
- Pedidos com mesmo `pack_id` = 1 envio. Deduplicamos por `bucket:packId`.
- ML Seller Center pode ter dedup adicional (~8 pedidos) que nao e acessivel via API.

### CORS para imagens ML
- Imagens do ML CDN (`http2.mlstatic.com`) podem ter problemas de CORS no browser.
- Solucao: `product_image_url` e passada para o PDF service que faz `fetch()` client-side.
- Se CORS falhar, aparece placeholder "Sem imagem".
- Alternativa futura: proxy de imagem pelo backend (`/api/ml/image-proxy?url=...`).

### Timezone
- Dashboard usa `America/Sao_Paulo` para determinar "hoje".
- SLA dates comparadas como YYYY-MM-DD string (timezone-safe).

## API do Mercado Livre

### Endpoints usados:
- `GET /orders/search?seller={id}` — busca pedidos
- `GET /orders/{id}` — detalhes do pedido
- `GET /shipments/{id}` — status do envio
- `GET /shipments/{id}/items` — SLA e datas
- `GET /items/{id}` — detalhes do item (thumbnail, attributes)
- `GET /users/{id}/stores` — lojas do vendedor
- `POST /orders/{id}/notes` — notas no pedido
- `GET /shipments/{id}/label` — etiqueta de envio

### Autenticacao:
- OAuth2 Authorization Code Flow
- Token refresh: `POST https://api.mercadolibre.com/oauth/token` com grant_type=refresh_token
- Precisa de ML_CLIENT_ID e ML_CLIENT_SECRET como env vars
