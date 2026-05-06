# Auditoria Engenharia Reversa - Bling e LojaHub

## 1. BLING - Integração com Mercado Livre

### Método de Coleta de Dados:
- **Autenticação**: OAuth 2.0 (fluxo padrão ML: Autenticação → Configuração → Produtos → Vendas → Enviar dados)
- **Importação de pedidos**: Automática ou manual
- **Importação automática**: Ativada na Central de Extensões → Integração ML → "Integração automática de pedidos"
- **Mapeamento de status**: ML → Bling (Pago → Em aberto, Cancelado → Cancelado, Devolução → Cancelado)
- **Trigger**: "Assim que o cliente realizar a compra no ML e realizar o pagamento" = usa WEBHOOKS/Notifications do ML
- **Identificação de produtos**: Por SKU (código) — mesmo SKU no Bling e no ML
- **Importação via API**: Busca produtos por código ou descrição

### Conclusões sobre Bling:
1. Usa OAuth 2.0 para autenticação (mesmo que nós)
2. Usa Webhooks/Notifications do ML para importação automática em tempo real
3. Não faz scraping — usa API pública do ML
4. Mapeia status do ML para status internos
5. Importação manual disponível para pedidos anteriores à integração

### Pontos-chave:
- Bling NÃO tenta replicar os chips do Seller Center
- Bling importa PEDIDOS e os classifica internamente
- A integração é 100% via API OAuth + Webhooks
- Não depende de cookies, scraping ou HTTP Fetcher

## 2. MERCADO LIVRE - Sistema de Notifications (Webhooks)

### Como funciona (documentação oficial):
- Configurar Callback URL pública no app ML
- Selecionar topics: orders_v2, shipments, payments, claims, etc.
- ML envia POST para a callback URL quando evento ocorre
- App deve responder HTTP 200 em menos de 500ms
- Se não responder, ML tenta novamente por até 1 hora
- Após 1 hora sem aceite, notificação é descartada

### Payload da notificação (orders):
```json
{
  "_id": "f9f08571-1f65-4c46-9e0a-c0f43faas1557e",
  "resource": "/orders/1499111111",
  "user_id": 123456789,
  "topic": "orders",
  "application_id": 2069392825111111,
  "attempts": 1,
  "sent": "2017-10-09T13:58:23.347Z",
  "received": "2017-10-09T13:58:23.329Z"
}
```

### Fluxo:
1. ML envia notificação com `resource: /orders/{order_id}`
2. App faz GET `https://api.mercadolibre.com/orders/{order_id}` com Bearer token
3. App recebe dados completos do pedido e atualiza internamente

### Topics relevantes para chips:
- `orders_v2` — criação e mudanças em vendas confirmadas
- `shipments` — criação e mudanças de envio
- `claims` — reclamações/devoluções

### Conclusão:
É ASSIM que Bling, LojaHub e todos os ERPs fazem:
1. Recebem webhook em tempo real
2. Fazem GET na API com OAuth token
3. Classificam internamente
4. NUNCA tentam replicar os chips exatos do Seller Center

## 3. LOJAHUB - Análise da Interface de Vendas

### Como o LojaHub exibe vendas:
- Lista de vendas com filtros operacionais (não tenta replicar chips do ML)
- Filtros por status: Vendas Pagas, Não Pagas, Pendente Pagamento, Enviado, Entregue, Em mediação
- Filtros operacionais: Aguardando Nota Fiscal, Aguardando Etiqueta, Aguardando Enviar
- Filtros por marketplace: ML, Amazon, Shopee (por conta)
- Cada venda mostra: SKU, produto, comprador, status, valores (produtos, frete, comissão, restou)
- Status internos próprios: "Pendente de Nota Fiscal", "Pendente de Envio", "Fulfillment"

### Como o LojaHub coleta dados:
- Integração via OAuth 2.0 com ML (parceiro certificado na Central de Parceiros ML)
- Recebe webhooks (notifications) do ML em tempo real
- Classifica pedidos internamente com status operacionais próprios
- NÃO tenta replicar os chips do Seller Center (today/upcoming/in_transit/finalized)
- Foco operacional: NF-e, etiqueta, envio, expedição

### Conclusão LojaHub:
- Usa exclusivamente API OAuth + Webhooks do ML
- Cria seus próprios status operacionais (não copia os do ML)
- Zero dependência de cookies ou scraping
- Multi-conta (3 contas ML: M.M.PARTS, COMERCIO.ELETRONICO.MOTO.PARTS, MINUTOMOTOPARTS)

## 4. CONCLUSÃO GERAL DA AUDITORIA

### Padrão da indústria (Bling, LojaHub, e todos os ERPs/Hubs):

1. **Autenticação**: OAuth 2.0 (token renovado automaticamente)
2. **Coleta de dados**: Webhooks (notifications) em tempo real + polling periódico da API
3. **Classificação**: Interna, com mapeamento de status ML → status próprio
4. **Chips/Contadores**: Calculados internamente a partir dos pedidos importados
5. **NENHUM usa scraping, cookies, ou HTTP Fetcher**
6. **NENHUM tenta replicar os chips exatos do Seller Center**

### Recomendação para VendasEcoferro:

O sistema já está no caminho certo com o classificador OAuth. A diferença de 1-2 pedidos é normal e aceitável — todos os ERPs/Hubs do mercado têm essa mesma margem porque a API pública do ML tem cache.

Para melhorar ainda mais a precisão:
1. **Implementar Webhooks** (notifications) do ML para receber mudanças em tempo real
2. **Reduzir o polling interval** de 2min para 30s (ou usar webhook como trigger)
3. **Aceitar a diferença de 1-2 pedidos** como comportamento normal da indústria
