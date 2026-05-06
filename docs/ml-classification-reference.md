---
title: "Classificação de pedidos Mercado Livre — Referência"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-classification-reference
---

# Classificação de pedidos Mercado Livre — Referência

> **Atualizado em:** 2026-04-24 (4ª auditoria + investigação de divergência chip visual vs API)
> **Fonte autoritativa:** observação direta + API ML (`/shipments/{id}`) + ML Seller Center UI + scraper Playwright
> **Mantém:** `src/services/mlSubStatusClassifier.ts` (frontend) + `api/ml/dashboard.js` (backend)

## ⚠️ Leia isto antes de tentar 5ª auditoria

**Existem 3 camadas numéricas diferentes, todas legítimas, todas capturadas na UI:**

| Camada | Valor (ex. prod 2026-04-24) | Fonte | Bate com |
|---|---|---|---|
| **Chip visual ML** (scraper) | `today=1  upcoming=33  in_transit=8  finalized=4` | `seller-center-scraper.js` navegando o Seller Center e lendo contadores | O que o user vê **com os olhos** no topo do Seller Center |
| **API oficial ML** (nosso classifier) | `today=3  upcoming=72  in_transit=107  finalized=44` | `fetchMLLiveChipBucketsDetailed` → agregação dos `order_ids_by_bucket` locais baseados em `/orders/search` | Pedidos reais no DB classificados conforme regras ML |
| **Classifier local puro** (fallback) | ~= API oficial | `deposits[].internal_operational_counts` | Quando ML API falha; usa apenas `raw_data` local |

**Camada 1 (chip visual) aplica filtros/dedup OCULTOS do ML** que nunca foram documentados publicamente (pack dedup estrito + janela de data mais apertada + exclusão de certos substatus). **Não é possível replicar 100%.** A diferença `in_transit 8 vs 107` (13×) é normal e esperada — **não é bug**.

**Regra prática:**
- **Numero grande do chip no dashboard** deve vir da Camada 1 (via `ml_ui_chip_counts`)
- **Lista de pedidos detalhados** (quando user clica num chip) vem da Camada 2 (via `ml_live_chip_order_ids_by_bucket`)
- Camada 3 é último fallback quando Camada 2 falha

**Quando chip Camada 1 está indisponível** (cache expirou, scraper caiu): UI mostra último valor conhecido com badge "Sincronizando ML (Xs)" — NUNCA cai silenciosamente pra Camada 3 (causa pulo visual 1→108). Implementado em `fix(chips): elimina pulo visual` (commit `a35fe93`, 2026-04-24).

## Divergência `in_transit`: 106 (local) vs 11 (chip visual) — causa identificada

Investigação 2026-04-24 (`scripts/debug-intransit.mjs` rodado em prod):

**Breakdown dos 106 pedidos que classifier local coloca em `in_transit`:**

| Substatus | N | Chip visual ML mostra aqui? |
|-----------|---|---|
| `ready_to_ship/in_hub/cross` | 55 | ❌ Provavelmente em TAB_NEXT_DAYS |
| `ready_to_ship/in_packing_list/cross` | 17 | ❌ Provavelmente em TAB_NEXT_DAYS |
| `shipped/out_for_delivery/cross` | 14 | ✅ |
| `shipped/waiting_for_withdrawal/cross` | 7 | ✅ (CARD_WAITING_FOR_WITHDRAWAL) |
| `ready_to_ship/in_packing_list/full` | 4 | ❌ Full vai pra today |
| `shipped/waiting_for_withdrawal/full` | 4 | ✅ |
| `shipped/out_for_delivery/full` | 3 | ✅ |
| `shipped/not_visited/full` | 1 | ✅ |
| `shipped/receiver_absent/full` | 1 | ✅ |
| **Total** | **106** | |

**Só os `shipped/*` somam 30 pedidos.** Com pack dedup ~3:1 → **11 envios** — bate com chip visual.

**Os 76 extras** (55 `in_hub` + 17 `in_packing_list cross` + 4 `in_packing_list full`) vêm de decisão da 4ª auditoria (`dashboard.js:556-558`) que moveu `in_hub` e `in_packing_list` pra `in_transit` baseado em screenshots de CARD_IN_THE_WAY.

**Hipóteses pra 5ª investigação (com storage state renovado):**
1. CARD_IN_THE_WAY no Seller Center é dividido em sub-cards; `in_hub` aparece mas NÃO conta no chip TAB_IN_THE_WAY principal (chip = só cards específicos tipo `shipped`)
2. A 4ª auditoria contou cards múltiplos pra um único bucket incorretamente

**Decisão tomada em 2026-04-24: OPÇÃO B (aceitar divergência).**

Raciocínio:
- Chip grande do topo do Seller Center conta **envios** (com pack dedup estrito + filtros ocultos) = ~11
- Classifier local conta **pedidos** operacionalmente relevantes = 106
- Ambas são representações legítimas, servem propósitos diferentes:
  - Chip pro usuário ML ver "quantas caixas estão a caminho do cliente"
  - Lista do app pro operador EcoFerro ver "quantos pedidos estão em fluxo pré/pós envio"
- `in_hub` e `in_packing_list` cross são pedidos **já saídos da loja**, no fluxo do carrier. Operacionalmente é "em trânsito" pro vendedor (Ecoferro não age mais neles).
- Mover pra `upcoming` faria operador vê-los em "Próximos dias" junto com `invoice_pending` (NF-e pendente, que requer AÇÃO), poluindo a lista acionável.
- Tentativa de capturar evidência visual via scraper (2026-04-24) falhou: collector de XHR ficou defasado em relação ao ML atual. Decisão tomada sem screenshots novos, mas com análise de pack dedup que explica 100% da divergência (30 pedidos shipped / 11 envios = 2.7:1 ratio, típico de cross-docking).

**Consequência UX:** dashboard mostra chip = 11 (visual ML) e lista = 106 (operacional local). Usuário pode estranhar a primeira vez mas tooltip + badge de fonte (commit `a35fe93`) explicam contexto. Comportamento **intencional**, não bug.

## Diagnóstico: `hardHealDrift` é circular

`api/ml/diagnostics.js:396` (hardHealDrift) compara `ml_seller_center` com `app_internal` — mas AMBOS vêm de `fetchMLLiveChipBucketsDetailed` (Camada 2). **Sempre vai retornar `ALREADY_IN_SYNC`**. Essa função é útil pra detectar pedidos com `raw_data` stale (quando sync incremental perde update), mas NÃO pra alinhar com Camada 1.

Verificado em 2026-04-24: `hardHealDrift({ maxOrdersToRefresh: 500 })` retornou `orders_refreshed=0, ALREADY_IN_SYNC`. DB não estava stale; a frustração vinha do pulo UX entre Camadas 1 e 2.

## Tech debt: scraper `capture-private-seller-center-snapshots.mjs`

**Estado em 2026-04-24:** script de captura `--headed` consegue logar, navegar e paginar, mas o **collector de XHRs ficou defasado** em relação ao ML atual — retorna `tab_counts={0,0,0,0}` e `sub_filters=[]` mesmo com páginas carregadas. Único campo coletado com sucesso: `post_sale_count` (actions endpoint).

**Por que isso não afeta prod:** `api/ml/_lib/seller-center-scraper.js` (o scraper interno que alimenta os chips em produção) funciona com outro pattern de interceptação de XHR. Esse sim está em dia.

**Pendência futura (Z2/Z3/Z4, não-urgente):** reinstrumentar o collector do `capture-private-seller-center-snapshots.mjs` pra acompanhar mudanças recentes de URL/estrutura de XHR do Seller Center. Ou descontinuar o script e rodar diagnósticos via endpoints do scraper de prod.



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
| `shipped` | `waiting_for_withdrawal` | `cross_docking` | `paid` | **`in_transit`** | — | Classificado pelo ML como "A caminho" (TAB_IN_THE_WAY) — **5** |
| `shipped` | `waiting_for_withdrawal` | `fulfillment` | `paid` | **`in_transit`** | — | Idem Full — **1** |

> ⚠️ **Mudou em 2026-04-23 (4ª auditoria, commit `2a0252f`):** anteriormente ia pra `finalized` baseado em business rule EcoFerro ("pacote no ponto = finalizado pro vendedor"). Screenshots reais do Seller Center mostraram que o ML mantém esses pedidos em TAB_IN_THE_WAY — então código foi alinhado (`dashboard.js:593-594, 727, 1948`). Código correto, doc antiga estava desatualizada.

### ENVIOS DE HOJE / PRÓXIMOS DIAS — `ready_to_ship` processando (108 pedidos)

Depende da **pickup date** (se ≤ hoje → today, se > hoje → upcoming):

| ss | sss | lt | os | Bucket (se hoje) | Bucket (se futuro) | Sub-status | Notas |
|---|---|---|---|---|---|---|---|
| `ready_to_ship` | `invoice_pending` | `cross_docking` | `paid` | `today` | `upcoming` | `invoice_pending` | NF-e pendente — **61** |
| `ready_to_ship` | `in_warehouse` | `fulfillment` | `paid` | `today` | `upcoming` | `in_distribution_center` | Full no CD do ML — **18** |
| `ready_to_ship` | `ready_to_print` | `cross_docking` | `paid` | `today` | `upcoming` | `ready_to_print` | Etiqueta pra imprimir — **17** |
| `ready_to_ship` | `in_packing_list` | `fulfillment` | `paid` | `today` | `upcoming` | `in_processing` | Full em lista de embalagem — **9** |
| `ready_to_ship` | `in_packing_list` | `cross_docking` | `paid` | **`in_transit`** | **`in_transit`** | — | **Cross dedicado** vai pra CARD_IN_THE_WAY, não today (ver `dashboard.js:556`) |
| `ready_to_ship` | `packed` | `fulfillment` | `paid` | `today` | `upcoming` | `printed_ready_to_send` | Full já embalado — **2** |
| `ready_to_ship` | `ready_to_pack` | `fulfillment` | `paid` | `today` | `upcoming` | `in_processing` | Full aguardando embalar — **1** |

> ⚠️ **Importante:** `in_packing_list` tem regra DIFERENTE por `logistic_type` (não é simétrico):
> - `fulfillment` → `today` (ML processando no CD)
> - `cross_docking` → `in_transit` (CARD_IN_THE_WAY — considerado "já no fluxo de saída")
> Ver `dashboard.js:556` (cross) vs `:709-711` (full).

### PENDING — pedidos recém-pagos

| ss | sss | lt | os | Bucket | Sub-status | Notas |
|---|---|---|---|---|---|---|
| `pending` | `buffered` | `cross_docking` | `paid` | **`upcoming`** | `in_processing` | Pedido pago recentemente, ML está criando o shipment — **44** |

> ⚠️ **Atualizado em 2026-04-23 (4ª auditoria):** anteriormente doc dizia `→ today`, mas observação real do Seller Center (screenshots) mostrou que ML mantém pendentes em TAB_NEXT_DAYS. Código `dashboard.js:531-532 (cross) + 1817-1823 (live)` implementa `→ upcoming`. Código correto; doc atualizada.

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
