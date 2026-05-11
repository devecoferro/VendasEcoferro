# Diagnóstico Técnico: Divergências e Latência na Integração Mercado Livre

Este documento apresenta a análise arquitetural das divergências numéricas, latência e inconsistências entre os módulos do painel VendasEcoferro e o Mercado Livre (Seller Center). A análise baseia-se na engenharia reversa das APIs do Mercado Livre, Bling e LojaHub, bem como na auditoria do código-fonte atual (`dashboard.js`, `orders.js`, `useMercadoLivreData.ts` e `mirror-storage.js`).

---

## 1. Causa Raiz das Divergências Restantes e Latência

### Divergências Numéricas (Chips)
Apesar das melhorias já implementadas (deduplicação por `pack_id`, ajustes de substatus e thresholds de data), os chips do dashboard ainda apresentam pequenas divergências em relação ao Mercado Livre (ex: 88/201/9/1 vs. valores locais). A causa raiz reside em **três fatores arquiteturais**:

1. **Filtro de Pagamento (`pending` vs `paid`)**: O código atual (`dashboard.js`, linha 2043) filtra pedidos `pending` exigindo que o status seja `paid` ou `confirmed`. No entanto, o Mercado Livre Seller Center frequentemente oculta pedidos `paid` que estão em verificação de fraude (status interno não exposto via API pública) ou inclui pedidos `pending` que já tiveram o pagamento pré-aprovado via Mercado Pago, mas a API de orders ainda não refletiu a mudança.
2. **Latência de Sincronização (Polling vs. Webhooks)**: O sistema atual depende de polling (busca ativa) ou sincronização sob demanda. Quando o Mercado Livre atualiza um substatus (ex: `ready_to_pack` para `in_hub`), o Seller Center reflete instantaneamente. O nosso painel só reflete após o próximo ciclo de sync ou quando o cache de 50s (`ML_LIVE_DETAILED_CACHE_TTL_MS`) expira.
3. **Classificação de Full (Fulfillment)**: A engenharia reversa (06/05/2026) revelou que pedidos Full em `in_packing_list` ou `in_warehouse` não contam no chip "Envios de hoje" do Seller Center. O código tenta excluir esses pedidos (linha 2301), mas a detecção de Full (`isFull`) depende de `logisticType === "fulfillment"` ou do prefixo `node:` no `deposit_key`. Se a API demorar a retornar o `logisticType` correto no endpoint `/shipments/{id}`, o pedido vaza para o chip `upcoming`.

### Latência e Resultados Parciais (Grid de Pedidos)
A lentidão e o carregamento parcial do grid de pedidos são causados por **desacoplamento de paginação e renderização otimista**:

1. **Paginação Independente**: O hook `useMercadoLivreData.ts` busca pedidos na rota `/api/ml/orders` com `DEFAULT_PAGE_SIZE=1000`. Ele permite que a interface renderize a primeira página enquanto as páginas subsequentes ainda estão sendo carregadas em background (`autoLoadAllPages`).
2. **Cache Desalinhado**: A rota `/api/ml/orders` possui um cache de 5 minutos, enquanto o `dashboard.js` (chips) possui um cache de 50 segundos. Isso garante que, durante 4 minutos e 10 segundos, os chips podem mostrar dados mais recentes que o grid.

---

## 2. Causa Raiz da Divergência entre Módulos Internos

O sistema possui quatro fontes de verdade que operam com semânticas diferentes, causando a percepção de inconsistência:

| Módulo | Fonte de Dados | Semântica | Cache/TTL |
| :--- | :--- | :--- | :--- |
| **Chips (Dashboard)** | `fetchMLLiveChipBucketsDetailed` | Busca **Live** na API ML, agrupa por `pack_id`, aplica regras de negócio complexas (SLA, substatus). | 50 segundos |
| **Grid (Orders)** | `fetchStoredOrders` via `/api/ml/orders` | Banco de dados local (`ml_orders`), agrupa itens por `order_id` (não por `pack_id`), foca em dados para NF-e. | 5 minutos |
| **Seller Center Mirror** | `mirror-storage.js` | Banco de dados local (tabelas separadas para returns, claims, packs). Atualizado via sync assíncrono. | Persistente (Sync) |
| **Private Snapshot** | `private-seller-center-storage.js` | Capturas pontuais (scraping/extensão) da UI privada do ML. | Estático (Point-in-time) |

**Por que divergem?**
O grid (`orders.js`) não agrupa por `pack_id` da mesma forma que os chips. Se um cliente compra 3 itens em 3 pedidos separados que o ML agrupa em 1 pacote (`pack_id`), os chips contam **1** (correto para logística), mas o grid pode mostrar **3** linhas (correto para faturamento). Além disso, o `seller_center_mirror` é explicitamente marcado no código como `{ status: "partial", incomplete: true }`, servindo apenas como auditoria de pós-venda, não como motor operacional.

---

## 3. Bug vs. Limitação da API vs. Diferença de UI

Para alinhar expectativas, é crucial separar o que pode ser corrigido do que é limitação da plataforma:

### A. Bugs Corrigíveis (Nosso Código)
* **Desalinhamento de Cache**: O grid e os chips usam TTLs diferentes (5 min vs 50s).
* **Falta de Agrupamento Visual no Grid**: O grid mostra `order_id` em vez de consolidar visualmente por `pack_id`, causando confusão no usuário que compara as linhas do grid com o número do chip.
* **Dependência de Polling**: A falta de Webhooks faz com que o sistema local fique obsoleto minutos após uma mudança no ML.

### B. Limitações da API Pública do Mercado Livre
* **Filtro de Fraude/Pagamento**: A API pública não expõe o status interno de "análise de fraude" em tempo real. O Seller Center oculta esses pedidos, mas a API os retorna como `pending` ou `paid`.
* **Atraso na Propagação do SLA**: O endpoint `/shipments/{id}/sla` às vezes demora minutos para refletir a mesma data que o Seller Center já mostra na UI.
* **Certificação (Developer Partner Program)**: **Não resolve este problema.** A certificação oferece suporte comercial e limites de taxa maiores, mas **não libera APIs secretas** com os contadores exatos da UI. Plataformas como Bling usam as mesmas APIs públicas.

### C. Diferenças Aceitáveis de UI (Private UI)
* **Contagem de "Finalizadas"**: O Seller Center conta pedidos entregues *hoje* mais reclamações abertas. Tentar espelhar isso perfeitamente é frágil. O nosso sistema deve focar em "Finalizadas (Últimos 7 dias)" para fins operacionais, aceitando que o número será maior que o do ML.

---

## 4. Plano de Ação Concreto (Passo a Passo)

Para resolver as divergências operacionais e preparar o sistema para o modelo SaaS, execute os seguintes passos:

### Passo 1: Unificar a Fonte de Verdade (Backend)
Modifique `/api/ml/orders.js` para utilizar a mesma lógica de agrupamento por `pack_id` do `dashboard.js`.
* **Ação**: Criar uma função utilitária compartilhada `groupOrdersIntoPacks(orders)` que seja usada tanto para calcular os chips quanto para retornar a lista do grid.

### Passo 2: Sincronizar Caches e Paginação (Frontend)
Resolva a latência e o carregamento parcial no `useMercadoLivreData.ts`.
* **Ação**: Reduzir o cache do grid para 50s (igual aos chips).
* **Ação**: Adicionar um indicador visual claro na UI: *"Carregando mais pedidos..."* enquanto `fully_loaded` for falso, para que o usuário entenda por que o grid tem menos itens que o chip.

### Passo 3: Implementar Webhooks (Crucial)
A única forma de eliminar a divergência de "minutos" é reagir em tempo real.
* **Ação**: Implementar endpoints para receber Webhooks do Mercado Livre (tópicos `orders_v2` e `shipments`).
* **Ação**: Ao receber um webhook, invalidar imediatamente o `liveChipDetailedCache` e o `shipmentSlaCache` para aquele `seller_id`.

### Passo 4: Preparação para SaaS (Branding e Multi-tenant)
Atualmente, logos e nomes estão hardcoded no `AppSidebar.tsx` e `LoginPage.tsx`.
* **Ação**: Adicionar uma tabela `tenant_settings` (ou expandir `app_user_profiles`) com colunas: `company_name`, `logo_url`, `primary_color`.
* **Ação**: Modificar o frontend para buscar essas configurações no `/api/app-auth` e injetá-las via React Context, removendo os assets hardcoded.

---

## 5. O Que NÃO Deve Ser Modificado (E Por Quê)

1. **Não tente fazer scraping ou usar o `private_snapshot` como fonte operacional.**
   * *Por quê?* O scraping depende de cookies que expiram e quebram a automação. O sistema deve ser 100% baseado em OAuth (API oficial), mesmo que haja uma margem de erro de 1-2% em relação à UI do ML.
2. **Não altere a lógica de `isFull` (Fulfillment) para forçar contagem nos chips.**
   * *Por quê?* Pedidos Full são despachados pelo próprio Mercado Livre. Colocá-los no chip "Envios de hoje" confunde a operação de armazém do cliente (cross-docking), que achará que precisa separar pacotes que já estão no CD do ML.
3. **Não tente espelhar o chip "Finalizadas" perfeitamente.**
   * *Por quê?* O ML usa regras temporais complexas (ex: "entregue hoje no fuso horário X"). O valor operacional para o cliente é ter acesso ao histórico recente para auditoria. Manter a regra atual (entregues nos últimos 2 dias + claims abertas) é suficiente e estável.
4. **Não remova a paginação do Grid (`DEFAULT_PAGE_SIZE=1000`).**
   * *Por quê?* Tentar carregar todos os pedidos de uma vez causará timeouts (502 Bad Gateway) no servidor e travamento no navegador do cliente. A renderização otimista com carregamento em background é a arquitetura correta para SaaS.
