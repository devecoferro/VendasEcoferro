# Classificação de pedidos Mercado Livre — Referência

> **Atualizado em:** 2026-04-22 (engenharia reversa a partir de 1504 pedidos da base EcoFerro)
> **Fonte autoritativa:** observação direta + API ML (`/shipments/{id}`) + ML Seller Center UI
> **Mantém:** `src/services/mlSubStatusClassifier.ts` (frontend) + `api/ml/dashboard.js` (backend)

## Contexto

Cada pedido ML tem 4 dimensões que determinam onde ele aparece na UI:
- **`order.status`** (`os`): `paid` / `cancelled` / `pending`
- **`shipment_snapshot.status`** (`ss`): status principal do envio
- **`shipment_snapshot.substatus`** (`sss`): detalhamento do status
- **`shipment_snapshot.logistic_type`** (`lt`): `fulfillment` (Full) / `cross_docking` (coleta Ecoferro)

A combinação `(ss, sss, lt, os)` determina unicamente a classificação.

## Buckets do app (espelham ML Seller Center)

| Bucket do app | Tab ML Seller Center | Significado |
|---|---|---|
| `today` | Envios de hoje | Pedidos que precisam sair/ser processados HOJE |
| `upcoming` | Próximos dias | Pedidos com data de coleta futura (processar nos próximos dias) |
| `in_transit` | Em trânsito | Pedidos já expedidos, aguardando entrega |
| `finalized` | Finalizadas | Terminal — entregue, cancelado, devolvido |

## Mapping completo (27 combinações observadas na base)

### FINALIZADAS — `delivered` (1095 pedidos, 72,8%)

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `delivered` | `null` | `cross_docking` | `paid` | `finalized` | `delivered` | Entregue normal (Coleta) — **837** |
| `delivered` | `null` | `fulfillment` | `paid` | `finalized` | `delivered` | Entregue normal (Full) — **240** |
| `delivered` | `null` | `cross_docking` | `cancelled` | `finalized` | `delivered` | Entregue com order cancelada depois (raro) — **13** |
| `delivered` | `null` | `fulfillment` | `cancelled` | `finalized` | `delivered` | Idem Full — **5** |

### FINALIZADAS — `cancelled` antigo (>2 dias)

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `cancelled` | `null` | `cross_docking` | `cancelled` | `today` ou `finalized` | `cancelled_no_send` ou `cancelled_final` | Até 2 dias: today ("Não enviar"); depois: finalized — **62** |
| `cancelled` | `null` | `fulfillment` | `cancelled` | `today` ou `finalized` | idem | **7** |
| `cancelled` | `pack_splitted` | `fulfillment` | `cancelled` | `finalized` | `cancelled_final` | Pack foi dividido — terminal — **2** |
| `cancelled` | `fraudulent` | `fulfillment` | `cancelled` | `finalized` | `cancelled_final` | Fraude detectada — terminal — **1** |
| `cancelled` | `unfulfillable` | `fulfillment` | `cancelled` | `finalized` | `cancelled_final` | Indisponível em estoque Full — terminal — **1** |

### FINALIZADAS — devolução

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `not_delivered` | `returned` | `cross_docking` | `cancelled` | `finalized` | `returns_completed` | Devolução concluída — **4** |

### EM TRÂNSITO — `shipped` (98 pedidos)

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `shipped` | `null` | `cross_docking` | `paid` | `in_transit` | `shipped_collection` | A caminho (Coleta) — **39** |
| `shipped` | `null` | `fulfillment` | `paid` | `in_transit` | `shipped_full` | A caminho (Full) — **38** |
| `shipped` | `out_for_delivery` | `fulfillment` | `paid` | `in_transit` | `shipped_full` | Saindo pra entrega (Full) — **6** |
| `shipped` | `out_for_delivery` | `cross_docking` | `paid` | `in_transit` | `shipped_collection` | Saindo pra entrega — **3** |
| `shipped` | `soon_deliver` | `cross_docking` | `paid` | `in_transit` | `shipped_collection` | Chegando hoje — **3** |
| `shipped` | `at_the_door` | `fulfillment` | `paid` | `in_transit` | `shipped_full` | Motorista na porta — **1** |
| `shipped` | `not_visited` | `fulfillment` | `paid` | `in_transit` | `shipped_full` | Comprador ausente — **1** |

### EM TRÂNSITO — `ready_to_ship` já expedido (87 pedidos) ⚠️ fix 2026-04-22

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `ready_to_ship` | `picked_up` | `cross_docking` | `paid` | `in_transit` | `shipped_collection` | **JÁ COLETADO** — não deve ir pra Próximos dias — **78** |
| `ready_to_ship` | `dropped_off` | `cross_docking` | `paid` | `in_transit` | `shipped_collection` | Já no ponto ML — **9** |

### PARA RETIRAR (pacote no ponto de retirada)

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `shipped` | `waiting_for_withdrawal` | `cross_docking` | `paid` | **`finalized`** | — | **Business rule EcoFerro**: pacote no ponto = finalizado pro vendedor (comprador quem retira) — **5** |
| `shipped` | `waiting_for_withdrawal` | `fulfillment` | `paid` | **`finalized`** | — | Idem Full — **1** |

> ⚠️ `CLAUDE.md` tem esta regra: `"shipped/waiting_for_withdrawal NAO e em transito"`. A UI do ML mostra esses pedidos em "Em trânsito", mas pro workflow da EcoFerro eles são terminais (não há mais ação do vendedor).

### ENVIOS DE HOJE / PRÓXIMOS DIAS — `ready_to_ship` processando (108 pedidos)

Depende da **pickup date** (se ≤ hoje → today, se > hoje → upcoming):

| ss | sss | lt | os | Bucket (se hoje) | Bucket (se futuro) | Sub-status | Notas |
|---|---|---|---|---|---|---|---|
| `ready_to_ship` | `invoice_pending` | `cross_docking` | `paid` | `today` | `upcoming` | `invoice_pending` | NF-e pendente — **61** |
| `ready_to_ship` | `in_warehouse` | `fulfillment` | `paid` | `today` | `upcoming` | `in_distribution_center` | Full no CD do ML — **18** |
| `ready_to_ship` | `ready_to_print` | `cross_docking` | `paid` | `today` | `upcoming` | `ready_to_print` | Etiqueta pra imprimir — **17** |
| `ready_to_ship` | `in_packing_list` | `fulfillment` | `paid` | `today` | `upcoming` | `in_processing` | Full em lista de embalagem — **9** |
| `ready_to_ship` | `packed` | `fulfillment` | `paid` | `today` | `upcoming` | `printed_ready_to_send` | Full já embalado — **2** |
| `ready_to_ship` | `ready_to_pack` | `fulfillment` | `paid` | `today` | `upcoming` | `in_processing` | Full aguardando embalar — **1** |

### PENDING — pedidos recém-pagos (44 pedidos) ✅ resolvido

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `pending` | `buffered` | `cross_docking` | `paid` | **`today`** | `in_processing` | Pedido pago recentemente, ML está criando o shipment — **44** |

**Análise (2026-04-22):** todos os 44 pedidos tinham `sale_date` = hoje, `pickup_date` = null, `tags` contendo `paid`. São pedidos recém-criados aguardando ML processar o shipment — devem aparecer em "Envios de hoje" como "Em processamento" até ganharem substatus específico (`ready_to_print`, etc).

Regra aplicada:
```ts
if (shipStatus === "pending" && !isCancelled) return "today";
```

## Campos de `pickup_date` (prioridade no `parsePickupDate`)

Ordem de busca (primeiro encontrado, usa):
1. `shipment_snapshot.pickup_date`
2. `shipment_snapshot.estimated_delivery_limit`
3. `shipment_snapshot.shipping_option.estimated_schedule_limit`
4. `shipment_snapshot.shipping_option.estimated_delivery_limit`
5. `shipment_snapshot.shipping_option.estimated_delivery_final`
6. `shipment_snapshot.lead_time.estimated_schedule_limit`
7. `shipment_snapshot.lead_time.estimated_delivery_limit`
8. `shipment_snapshot.sla_snapshot.expected_date`
9. `raw.pickup_date`
10. `raw.shipping.pickup_date`

## Sub-status ativos em `not_delivered` (fica em trânsito, não finalized)

Quando `ship.status === "not_delivered"` e substatus ∈:
- `returning_to_sender` → in_transit
- `returning_to_hub` → in_transit
- `delayed` → in_transit
- `return_failed` → in_transit

Caso contrário → finalized.

## Cross-bucket

### Mensagens não lidas (`with_unread_messages`)
Detectado via `orderHasUnreadMessages(order)`:
- Tag `messages_with_unread_messages` (API ML)
- Tag `unread_messages`
- `raw.messages_unread === true`
- `raw.messenger.messages_unread === true`
- `raw.messenger.new_messages_amount > 0`

Pode aparecer em QUALQUER bucket como pill independente.

### Reclamação/mediação
Tag `claim` ou `mediation` → no bucket `finalized`, vira sub-status `claim_or_mediation` ("Para atender").

## Métricas atuais (pós-fix 2026-04-22 round 3)

Base: 1512 pedidos

| Bucket | Qtd | % |
|---|---|---|
| today | 46 | 3.0% |
| upcoming | 108 | 7.1% |
| in_transit | 178 | 11.8% |
| finalized | 1180 | 78.0% |

## Como re-auditar

Rodar no container:
```bash
docker exec <CID> node /app/scripts/audit-buckets-v2.mjs
```

Ou executar a query direta:
```sql
SELECT
  json_extract(raw_data,'$.shipment_snapshot.status') ss,
  json_extract(raw_data,'$.shipment_snapshot.substatus') sss,
  json_extract(raw_data,'$.shipment_snapshot.logistic_type') lt,
  json_extract(raw_data,'$.status') os,
  COUNT(*) n
FROM ml_orders
GROUP BY ss, sss, lt, os
ORDER BY n DESC;
```

## Changelog

- **2026-04-22** — Engenharia reversa inicial. Documentou 27 combinações. Identificou 63 pedidos mal classificados (`ready_to_ship + picked_up/dropped_off` indo pra upcoming em vez de in_transit). Fix aplicado em `mlSubStatusClassifier.ts`.
- **2026-04-22** — Adicionada regra `not_delivered + active_return_substatus → in_transit` pra alinhar com backend.
- **2026-04-22** — `parsePickupDate` expandido pra 10 candidatos (inclui `shipping_option.estimated_schedule_limit`, `sla_snapshot.expected_date`, etc).
- **2026-04-22 (round 3)** — `pending + any substatus` + paid → today (pedidos recém-pagos aguardando criação de shipment pelo ML). Resolve os 44 `pending|buffered` que estavam poluindo upcoming via fallback. Engenharia reversa via scraper ML (366 orders capturados) + análise direta dos raw_data.
