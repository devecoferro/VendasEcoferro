---
title: "ML Seller Center — Bricks Reverse Engineering"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-bricks-reverse-engineered
---

# ML Seller Center — Bricks Reverse Engineering

Descoberto via `scripts/deep-reverse-engineer-ml.mjs` + `scripts/debug-ml-dom-dump.mjs` em 2026-04-23 (sessão autenticada ECOFERRO, 4 depósitos × 4 tabs).

## Endpoint principal

**POST** `https://www.mercadolivre.com.br/vendas/omni/lista/api/channels/event-request`

Retorna árvore de "bricks" (sistema de componentização do ML). Cada brick tem:

```json
{
  "id": "string único",
  "uiType": "tipo do componente",
  "data": { ...props },
  "bricks": [ ...filhos ]
}
```

## uiTypes relevantes

| uiType | Papel |
|---|---|
| `dashboard_operations` | Root do painel de operações |
| `dashboard_operations_cards` | Container dos cards de classificação |
| `dashboard_operations_card` | **Card individual** |
| `dashboard_operations_task` | **Sub-status** dentro de um card |
| `segmented_actions` | Tabs principais (chips) |
| `filter_dates` | Dropdown de datas |
| `list` | Lista de pedidos |
| `action_button_tooltip` | Ex: "Gerenciar Pós-venda" |
| `general_actions` | Menu "Ações gerais" |
| `cards_fallback` | Estado vazio |
| `dashboard_operations_cards_skeleton` | Loading |

## CARD IDs canônicos (descobertos)

| Card ID | Aparece em | Tag | Label |
|---|---|---|---|
| `CARD_CROSS_DOCKING_TODAY` | ourinhos/today | `PROGRAMADA` | `Coleta \| 12 h - 14 h` |
| `CARD_CROSS_DOCKING_NEXT_DAYS` | ourinhos/next_days | — | `Coleta \| Amanhã` |
| `CARD_CROSS_DOCKING_AFTER_NEXT_DAY` | ourinhos/next_days | — | `Coleta \| A partir de {data}` |
| `CARD_RETURNS_TODAY` | ourinhos/today | — | `Devoluções` |
| `CARD_RETURNS_NEXT_DAYS` | ourinhos,unknown,full / next_days | — | `Devoluções` |
| `CARD_FULL` | full/today | `EM ANDAMENTO` | `Full` |
| `CARD_WAITING_FOR_WITHDRAWAL` | ourinhos,full / in_the_way | — | `Para retirar` |
| `CARD_IN_THE_WAY` | ourinhos,full / in_the_way | — | `A caminho` |
| `CARD_SALES_TO_ATTEND_FINISHED` | ourinhos/finished | — | `Para atender` |
| `CARD_CLOSED_SALES_FINISHED` | todas/finished | — | `Encerradas` |

## TASK IDs canônicos (mapping ML ↔ App)

| ML TASK_ID | ML Label | App `MLSubStatus` |
|---|---|---|
| `TASK_CANCELLED_DONT_DISPATCH` | Canceladas. Não enviar | `cancelled_no_send` |
| `TASK_READY_TO_DISPATCH` | Prontas para enviar | `ready_to_send` |
| `TASK_READY_TO_PRINT` | Etiquetas para imprimir | `ready_to_print` |
| `TASK_INVOICES_TO_BE_MANAGED` | NF-e para gerenciar | `invoice_pending` |
| `TASK_TRANSPORTATION_TO_BE_ASSIGNED` | Em processamento | `in_processing` |
| `TASK_TRANSPORTATION_SLOW_DELIVERY_TO_BE_ASSIGNED` | Por envio padrão | `standard_shipping` |
| `TASK_ARRIVING_TODAY` | Chegarão hoje | `return_arriving_today` |
| `TASK_PENDING_REVIEW` | Revisão pendente | `return_pending_review` |
| `TASK_RETURN_IN_THE_WAY` | A caminho | `return_in_transit` |
| `TASK_IN_REVIEW_WH` | Em revisão pelo Mercado Livre | `return_in_ml_review` |
| `TASK_PENDING_BUYER_WITHDRAW` | Esperando retirada do comprador | `waiting_buyer_pickup` |
| `TASK_CROSS_DOCKING` | Coleta | `shipped_collection` |
| `TASK_FULL` | Full | `shipped_full` |
| `TASK_FULFILLMENT` | No centro de distribuição | `in_distribution_center` |
| `TASK_WITH_CLAIMS_OR_MEDIATIONS` | Com reclamação ou mediação | `claim_or_mediation` |
| `TASK_DELIVERED` | Entregues | `delivered` |
| `TASK_NOT_DELIVERED` | Não entregues | `not_delivered` |
| `TASK_CANCELLED` | Canceladas | `cancelled_final` |
| `TASK_RETURNS_COMPLETED` | Devoluções concluídas | `returns_completed` |
| `TASK_RETURNS_NOT_COMPLETED` | Devoluções não concluídas | `returns_not_completed` |
| `UNREAD_MESSAGES` | Com mensagens não lidas | `with_unread_messages` |

## Segmented actions (tabs chips)

```json
{ "id": "TAB_TODAY",      "text": "Envios de hoje",    "count": "87" }
{ "id": "TAB_NEXT_DAYS",  "text": "Próximos dias",     "count": "87" }
{ "id": "TAB_IN_THE_WAY", "text": "Em trânsito",       "count": "6"  }
{ "id": "TAB_FINISHED",   "text": "Finalizadas",       "count": "5"  }
```

## Contagens reais por depósito × tab (2026-04-23, snapshot)

### `all` / Todas as vendas
- **Não mostra cards detalhados** — ML renderiza `cards_fallback` (empty state)
- Só chips agregados: `TAB_TODAY=87, TAB_NEXT_DAYS=87-88, TAB_IN_THE_WAY=6, TAB_FINISHED=4-5`

### `ourinhos` / Ourinhos Rua Dario Alonso
| Tab | Cards | Tasks |
|---|---|---|
| today | CARD_CROSS_DOCKING_TODAY (86) + CARD_RETURNS_TODAY (1) | cancelled_dont_dispatch (3), ready_to_dispatch (83), arriving_today (1) |
| next_days | CROSS_DOCKING_NEXT_DAYS (40) + AFTER_NEXT_DAY (15) + RETURNS (21) | invoices (6), transportation (6), slow_delivery (42), ready_to_print (1), pending_review (4), return_in_the_way (17) |
| in_the_way | WAITING_FOR_WITHDRAWAL (5) + IN_THE_WAY (127) | pending_buyer_withdraw (5), cross_docking (127) |
| finished | SALES_TO_ATTEND (2) + CLOSED_SALES_FINISHED (+999) | claims (2), delivered (+999), not_delivered (103), cancelled (95), returns_completed (25), returns_not_completed (9), unread_messages (3) |

### `full` / Mercado Envios Full
| Tab | Cards | Tasks |
|---|---|---|
| today | CARD_FULL (28) | fulfillment (28) |
| next_days | CARD_RETURNS_NEXT_DAYS (5) | return_in_the_way (5) |
| in_the_way | WAITING_FOR_WITHDRAWAL (1) + IN_THE_WAY (53) | pending_buyer_withdraw (1), full (53) |
| finished | CLOSED_SALES_FINISHED (567) | delivered (424), not_delivered (61), cancelled (24), returns_completed (40), returns_not_completed (18) |

### `unknown` / Vendas sem depósito
| Tab | Cards | Tasks |
|---|---|---|
| today | (sem cards) | — |
| next_days | CARD_RETURNS_NEXT_DAYS (5) | return_in_the_way (3), in_review_wh (2) |
| in_the_way | (sem cards) | — |
| finished | CLOSED_SALES_FINISHED (207) | delivered (20), not_delivered (84), returns_completed (85), returns_not_completed (18) |

Nota: counts por card podem não bater com o chip principal porque chips são deduped por shipment (pack_id).

### Descoberta importante: sub-status de "A caminho" varia por depósito
- Ourinhos `in_the_way` → CARD_IN_THE_WAY com task `TASK_CROSS_DOCKING` → label **"Coleta"** (127)
- Full `in_the_way` → CARD_IN_THE_WAY com task `TASK_FULL` → label **"Full"** (53)

Ambos renderizam mesmo card ("A caminho") mas o sub-status difere por logistic_type do pedido.

## Estrutura DOM (HTML renderizado)

Os bricks viram HTML com classes previsíveis:

- Container card: `.andes-card[data-andes-card=true]`
- Conteúdo: `.operation-dashboard-card__content`
- Header: `.operation-dashboard-card__header`
- Tag: `.operation-dashboard-card__tag > span.operation-dashboard-card__tag--text`
- Badge de count: `.operation-dashboard-card__sales-quantity > .andes-badge__content`
- Label: `.operation-dashboard-card__label`
- Container tasks: `.operation-dashboard-card__tasks--container`
- Cada task: `.sc-card-task[id^=TASK_]`
  - Label: `.sc-card-task__label span`
  - Count: `.sc-card-task__count`

## Observações importantes

- **Espaços no "12 h - 14 h"**: ML usa `"Coleta | 12 h - 14 h"` (com espaços ao redor do `h`) — NÃO remover.
- **Labels "para" (não "pra")**: confirmado via brick payload — ML escreve "NF-e **para** gerenciar", "Etiquetas **para** imprimir" etc.
- **Sub-status dinâmicos**: ao longo do dia o ML troca quais tasks aparecem (ex: "Etiquetas para imprimir" → "Prontas para enviar" conforme labels são impressos).
- **Tag dos cards varia**: `PROGRAMADA` só aparece em today/Ourinhos; `EM ANDAMENTO` só aparece em today/Full.
- **Card IDs carregam range de datas**: `CARD_CROSS_DOCKING_NEXT_DAYS-2026-04-24T00:00@START_DATE;2026-04-26T23:59:59@STOP_DATE` — ML agrupa 3 dias no card "Amanhã".
- **Store "all"**: NÃO retorna cards detalhados, só chips agregados. Cards são rendered por-depósito.

## Como refazer a captura

1. **Renova sessão** (se expirada): `node scripts/refresh-ml-session.mjs` (browser headed, login manual)
2. **Roda engenharia reversa**: `node scripts/deep-reverse-engineer-ml.mjs --headed`
   - Saída em `data/reverse-engineering/YYYY-MM-DD/<store>/<tab>/{bricks,dom,xhrs,meta}.json + screenshot.png`
   - Summary em `data/reverse-engineering/YYYY-MM-DD/summary.md`

## Limitações conhecidas do scraper

- **SPA routing perde XHR**: quando navegamos entre tabs/stores via `page.goto`, o ML pode reusar state da SPA e não re-disparar o XHR de cards. Solução parcial: aguardar a primeira captura de cada store antes de tentar as seguintes. Workaround completo: fechar e recriar o contexto entre captures.
- **Algumas combinações retornam 0 cards**: ex. `unknown/today` e `unknown/in_the_way`. Pode ser genuíno (sem pedidos nesse depósito+tab) ou refletir perda de XHR.
