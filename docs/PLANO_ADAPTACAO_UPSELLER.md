# Plano de Adaptação Técnica: UpSeller para VendasEcoferro/Fantom

**Autor:** Manus AI  
**Data:** 11 de maio de 2026  
**Objetivo:** Adaptar as melhores práticas arquiteturais e funcionais do UpSeller para o sistema VendasEcoferro (Fantom), eliminando divergências numéricas, reduzindo latência, expandindo o funil operacional e aprimorando o modelo SaaS multi-tenant.

---

## 1. Análise Comparativa: UpSeller vs. VendasEcoferro

A engenharia reversa do UpSeller revelou que a plataforma atua como um ERP omnichannel robusto, não apenas espelhando os status do Mercado Livre, mas criando uma **camada própria de orquestração** [1]. O VendasEcoferro atual possui uma base sólida, mas ainda apresenta gaps arquiteturais quando comparado ao modelo do UpSeller.

### 1.1. Arquitetura de Sincronização e Latência

| Característica | UpSeller | VendasEcoferro (Atual) | Gap Identificado |
| :--- | :--- | :--- | :--- |
| **Mecanismo Principal** | Webhooks oficiais (`orders_v2`, `shipments`, `payments`) + Polling complementar [2]. | Polling ativo a cada 30s (`sync.js`) + Webhooks básicos (`notifications.js`). | O VendasEcoferro já recebe webhooks, mas o grid de pedidos (`orders.js`) depende de um cache de 5 minutos, causando latência visual. |
| **Tempo de Resposta** | Quase em tempo real (event-driven). | Atraso de até 5 minutos no grid; 50s nos chips. | Desalinhamento de TTLs entre módulos internos. |
| **Fonte de Verdade** | Banco de dados interno normalizado. | Múltiplas fontes (`dashboard.js` usa API Live; `orders.js` usa DB local). | Falta de unificação total. O PR #38 unificou a chave (`pack_key`), mas a fonte de dados ainda difere. |

### 1.2. Modelagem de Status e Funil Operacional

O UpSeller divide o ciclo de vida do pedido em micro-tarefas operacionais, independentemente do status bruto do marketplace [3].

| Estágio Operacional | UpSeller (Status Interno) | VendasEcoferro (Status Atual) | Gap Identificado |
| :--- | :--- | :--- | :--- |
| **Alocação de Estoque** | `Para Reservar` (`allocateStatus`) | Não possui separação explícita. | Pedidos pagos entram direto em "Envios de hoje" ou "Próximos dias", sem validação de estoque físico. |
| **Emissão Fiscal** | `Para Emitir` (`invoiceStatus`) | Emissão manual via botão "Gerar NF-e". | Não há um bucket/chip dedicado para "Aguardando NF-e". |
| **Logística/Etiqueta** | `Para Enviar` / `Para Imprimir` | Agrupado em "Envios de hoje". | Falta separação entre "Pronto para faturar", "Pronto para imprimir" e "Pronto para despachar". |
| **Expedição** | `Para Retirada` / `Enviado` | `Em trânsito` | O VendasEcoferro agrupa tudo pós-postagem. O UpSeller monitora falhas de coleta (`pickup_failed`). |

### 1.3. Customização e Multi-tenant (SaaS)

| Funcionalidade | UpSeller | VendasEcoferro (Atual) | Gap Identificado |
| :--- | :--- | :--- | :--- |
| **Branding** | Personalização completa por conta. | Tabela `tenant_settings` recém-criada (PR #38). | O backend suporta, mas falta expandir para limites de plano (ex: max_connections, max_users). |
| **Etiquetas** | Editor visual de etiquetas (drag & drop). | PDF gerado via código (`pdfExportService.ts`). | A etiqueta do Ecoferro é fixa (hardcoded). Não permite que o cliente SaaS altere fontes, posições ou adicione campos customizados. |

---

## 2. Plano de Implementação Priorizado

Com base nos gaps identificados, propomos um plano de ação em 4 fases para elevar o VendasEcoferro ao padrão UpSeller.

### Fase 1: Unificação Arquitetural e Real-time (Alta Prioridade)
**Objetivo:** Eliminar a latência e garantir que chips e grid mostrem exatamente os mesmos dados no mesmo instante.

1. **Reforço dos Webhooks:**
   - Expandir `api/ml/notifications.js` para processar ativamente os tópicos `payments` e `stock fulfillment`.
   - Implementar invalidação cirúrgica: ao receber um webhook de `shipments`, atualizar apenas a linha correspondente no DB e invalidar o cache específico, em vez de forçar um sync completo.
2. **Unificação da Fonte de Dados:**
   - Alterar `dashboard.js` para consumir dados **exclusivamente do banco de dados local** (`ml_orders`), abandonando a chamada Live (`fetchMLLiveChipBucketsDetailed`).
   - Isso garante que chips e grid leiam da mesma tabela. A latência será resolvida pela atualização instantânea via webhooks.

### Fase 2: Expansão do Funil Operacional (Média Prioridade)
**Objetivo:** Replicar a granularidade de tarefas do UpSeller para guiar a equipe de armazém.

1. **Novos Status Internos (Colunas no DB):**
   - Adicionar colunas em `ml_orders`: `internal_status` (enum: `pending_stock`, `pending_invoice`, `pending_print`, `ready_to_ship`, `shipped`).
2. **Novos Chips no Dashboard:**
   - Desdobrar "Envios de hoje" em: **Para Reservar** (estoque pendente), **Para Emitir** (NF-e pendente), **Para Imprimir** (etiqueta pendente) e **Para Retirada** (pronto no doca).
3. **Motor de Transição de Status:**
   - Criar um worker que avalia regras: Se `order.status == 'paid'` E `stock > 0` -> move para `Para Emitir`. Se NF-e emitida -> move para `Para Imprimir`.

### Fase 3: Customização Avançada de Etiquetas (Média Prioridade)
**Objetivo:** Permitir que clientes SaaS personalizem suas etiquetas de conferência.

1. **Modelo de Dados do Template:**
   - Criar tabela `label_templates` vinculada ao `profile_id`, armazenando um JSON com a definição do layout (coordenadas X/Y, tamanho da fonte, campos visíveis).
2. **Refatoração do `pdfExportService.ts`:**
   - Alterar o gerador de PDF para ler o JSON do template do banco de dados em vez de usar coordenadas hardcoded.
3. **Editor Visual (Frontend):**
   - Desenvolver uma interface drag-and-drop (usando bibliotecas como `react-rnd` ou `dnd-kit`) no painel `/admin/tenant-settings` para o usuário montar sua etiqueta.

### Fase 4: Evolução do Modelo SaaS (Baixa Prioridade)
**Objetivo:** Preparar a plataforma para monetização e controle de limites.

1. **Gestão de Planos:**
   - Expandir `app_user_profiles` ou criar tabela `subscriptions` com campos: `plan_tier` (Free, Pro, Enterprise), `max_connections` (limite de contas ML), `max_users` (limite de operadores).
2. **Bloqueios Operacionais:**
   - Implementar middlewares no Express que verifiquem os limites do plano antes de permitir a adição de uma nova conta ML ou a emissão de NF-e em massa.

---

## 3. Limitações Técnicas e Pontos de Atenção

É fundamental alinhar expectativas sobre o que **não pode** ser resolvido apenas com código, devido a limitações da API pública do Mercado Livre [4]:

1. **Pedidos em Análise de Fraude:** A API pública retorna pedidos em análise como `pending` ou `paid`, mas o Seller Center os oculta da interface. O VendasEcoferro continuará mostrando esses pedidos antes do Seller Center. Esta é uma limitação intransponível sem acesso a APIs privadas.
2. **Atraso na Propagação do SLA:** O endpoint `/shipments/{id}/sla` pode demorar alguns minutos para refletir mudanças feitas internamente pelo ML. O uso de webhooks mitiga isso, mas não elimina o atraso na origem.
3. **Contagem de "Finalizadas":** O Mercado Livre utiliza regras temporais complexas e fusos horários específicos para definir o que foi "entregue hoje". Tentar espelhar esse número perfeitamente é frágil. A recomendação é manter a janela de 2 dias ou 7 dias como padrão operacional.

## Referências

[1] Relatório técnico de engenharia reversa funcional do UpSeller.
[2] Mercado Libre Developers — Receive notifications.
[3] Notas de engenharia do UpSeller.
[4] Mercado Livre Developers — Pedidos e opiniões.
