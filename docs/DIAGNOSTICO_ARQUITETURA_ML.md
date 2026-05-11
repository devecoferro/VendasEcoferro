# Diagnóstico Técnico: Arquitetura, Divergências e Funil Operacional

Este documento apresenta a análise arquitetural da integração com o Mercado Livre, detalhando a unificação de dados (chips vs. grid), o novo funil operacional inspirado no UpSeller, e as limitações inerentes da API pública do Mercado Livre.

---

## 1. Unificação Arquitetural: Fim da Divergência Chips vs. Grid

Historicamente, o sistema apresentava divergências numéricas entre os chips do dashboard e a lista de pedidos (grid). Isso ocorria porque os chips consumiam dados em tempo real da API (`fetchMLLiveChipBucketsDetailed`), enquanto o grid consumia do banco de dados local (`ml_orders`), com TTLs e lógicas de agrupamento diferentes.

### A Solução Implementada (Fase 1 e 2)
A arquitetura foi unificada para usar o **banco de dados local (`ml_orders`) como fonte única de verdade** para ambos os módulos.

1. **Agrupamento por `pack_id`**: Tanto o dashboard quanto o grid agora utilizam a mesma lógica de deduplicação (`deduplicateOrdersToPacks` via `pack_key`). Se um cliente compra 3 itens em 3 pedidos separados que o ML agrupa em 1 pacote, o sistema conta como **1 envio**, alinhando-se perfeitamente à logística do Seller Center.
2. **Webhooks Cirúrgicos**: A latência foi eliminada através da implementação de webhooks para os tópicos `orders_v2`, `shipments` e `payments`. Ao receber um evento, o sistema invalida o cache e atualiza o banco local instantaneamente, garantindo que a UI reflita a realidade sem depender de polling.
3. **Abandono da Chamada Live**: A função `fetchMLLiveChipBucketsDetailed` foi descontinuada como fonte primária. O cálculo dos chips agora é feito via `computeDBChipCounts()`, aplicando as regras de SLA e substatus diretamente sobre os dados locais atualizados.

---

## 2. O Novo Funil Operacional (Inspirado no UpSeller)

A análise de engenharia reversa do UpSeller revelou que a operação de e-commerce exige uma granularidade maior do que os status nativos do Mercado Livre. O chip "Envios de hoje" foi desdobrado em um funil operacional de 4 etapas:

| Etapa (UI) | Função Interna | Equivalente UpSeller | Status ML Correspondente |
| :--- | :--- | :--- | :--- |
| **Para Reservar** | `isOrderPendingStock` | `allocateStatus=out_stock` | Pedido `paid` com `shipping.status=pending` |
| **Para Emitir** | `isOrderInvoicePending` | `invoiceStatus=to_issue` | `invoice_pending` |
| **Para Imprimir** | `isOrderReadyToPrintLabel` | `printCount=unPrinted` | `ready_to_print` (com NF-e emitida) |
| **Para Retirada** | `isOrderForCollection` | `pickupStatus=to_pickup` | `ready_for_pickup` / `collection_ready` |

Este funil permite que a equipe de expedição atue em linha de montagem, focando apenas nos pedidos que estão prontos para a próxima etapa, sem confusão com pedidos aguardando processamento do ML (Para Reservar).

---

## 3. Limitações Inerentes da API Pública do Mercado Livre

Apesar da unificação arquitetural, algumas divergências em relação ao Seller Center são **limitações da plataforma** e não podem ser resolvidas via código. É crucial alinhar essas expectativas com os usuários do SaaS:

1. **Pedidos em Análise de Fraude ("Ghost Orders")**: O Seller Center frequentemente oculta pedidos que estão em verificação de fraude. No entanto, a API pública os retorna como `paid` ou `pending`. Isso pode causar uma contagem ligeiramente maior no nosso painel.
2. **Atraso na Propagação do SLA**: O endpoint `/shipments/{id}/sla` pode demorar minutos para refletir a mesma data de postagem que o Seller Center já mostra na UI.
3. **Contagem de "Finalizadas"**: O Seller Center usa regras temporais complexas (ex: "entregue hoje no fuso horário X" + reclamações abertas). Nosso sistema foca em "Finalizadas (Últimos 2 dias)" para fins operacionais, aceitando que o número será diferente da UI do ML.
4. **Certificação (Developer Partner Program)**: A certificação oferece suporte comercial e limites de taxa maiores, mas **não libera APIs secretas** com os contadores exatos da UI. Plataformas como Bling e UpSeller lidam com as mesmas limitações.

---

## 4. Customização SaaS: Templates de Etiqueta

Para suportar múltiplos lojistas (SaaS), o sistema agora possui um motor de **Templates de Etiqueta** configurável por tenant.

* **Tabela `label_templates`**: Armazena o layout em formato JSON (dimensões, cores, campos).
* **Editor Visual**: A rota `/admin/label-templates` oferece uma interface drag-and-drop para ajustar posições (X/Y), tamanhos, fontes e visibilidade de elementos como Logo, SKU, QR Code e Dados do Comprador.
* **Fallback Padrão**: Novos tenants recebem automaticamente o layout `DEFAULT_LABEL_LAYOUT`, que espelha a etiqueta clássica da Ecoferro.

---

## 5. O Que NÃO Deve Ser Modificado (E Por Quê)

1. **Não tente fazer scraping ou usar o `private_snapshot` como fonte operacional.**
   * *Por quê?* O scraping depende de cookies que expiram e quebram a automação. O sistema deve ser 100% baseado em OAuth (API oficial) e Webhooks.
2. **Não altere a lógica de `isFull` (Fulfillment) para forçar contagem nos chips.**
   * *Por quê?* Pedidos Full são despachados pelo próprio Mercado Livre. Colocá-los no chip "Envios de hoje" confunde a operação de armazém do cliente (cross-docking).
3. **Não remova a paginação do Grid (`DEFAULT_PAGE_SIZE=1000`).**
   * *Por quê?* Tentar carregar todos os pedidos de uma vez causará timeouts (502 Bad Gateway). A renderização otimista com carregamento em background é a arquitetura correta para SaaS.
