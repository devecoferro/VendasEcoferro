---
title: "ML Chip Sync — Histórico de Engenharia Reversa e Estado Atual"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-chip-sync-notes
---

# ML Chip Sync — Histórico de Engenharia Reversa e Estado Atual

**Data:** 2026-04-23 a 2026-04-24
**Contexto:** sessão longa de alinhamento dos chips do nosso dashboard
(`vendas.ecoferro.com.br`) com os chips do Mercado Livre Seller Center.

## Problema original

Chips do nosso app mostravam números diferentes do ML Seller Center:

| Aba | Nosso (antes) | ML chip |
|---|---|---|
| Envios de hoje | 81 | 5 |
| Próximos dias | 160 | 124 |
| Em trânsito | 2 | 6 |
| Finalizadas | 50 | 4 |

## Tentativas e iterações

### 1ª auditoria (commits `28b322f` → revertido `afabf11`)
- Adicionou: `cancelled` de hoje → today, `shipped/null` → today
- Resultado: inflou today de 50 pra 114 — revertido.

### 2ª auditoria (commit `5985485` → revertido)
- Mudou `in_hub`, `in_packing_list`, `in_warehouse` pra outros buckets
- Erro: tratou Full `in_packing_list` igual cross-docking — ML separa.

### 3ª auditoria (commit `e7fb12a` → revertido)
- Introduziu `isRecentCancellationForTodayBucket` com janela 24-36h
- Não resolveu o gap de today (ML 5 vs nosso 81).

### 4ª auditoria — definitiva (commit `2a0252f` + `be69d9a`)
Baseada em **screenshots reais** do ML capturados via playwright com storage state:

**Regras finais do classifier** (espelha o ML visual):

| logistic_type | shipment.status | shipment.substatus | Bucket |
|---|---|---|---|
| cross | ready_to_ship | ready_for_pickup/packed/ready_to_pack | today |
| cross | ready_to_ship | ready_to_print | today |
| cross | ready_to_ship | **in_hub** | **in_transit** |
| cross | ready_to_ship | **in_packing_list** | **in_transit** |
| cross | ready_to_ship | invoice_pending | upcoming |
| cross | shipped | waiting_for_withdrawal | **in_transit** |
| cross | shipped | null (recente ≤3d) | in_transit |
| cross | shipped | out_for_delivery/etc (≤3d) | in_transit |
| cross | cancelled (hoje/ontem) | * | today |
| cross | cancelled (antigo) | * | finalized |
| **full** | ready_to_ship | **in_warehouse** | **today** |
| **full** | ready_to_ship | **in_packing_list** | **today** (diferente do cross!) |
| full | ready_to_ship | in_hub | in_transit |
| full | shipped | null (recente) | in_transit |
| full | shipped | waiting_for_withdrawal | in_transit |

### 5ª tentativa — ml-chip-proxy (commit `d59bcf8`)
**Descoberta do endpoint oficial:**
```
GET /sales-omni/packs/marketshops/operations-dashboard/tabs
Header: x-scope: tabs-mlb
Acesso: POST /vendas/omni/lista/api/channels/event-request
        + cookies sessão ML + x-csrf-token
```

Resposta tem `response[0].data.bricks[0].data.segments[]` com 4 chips.

**Implementação:** `api/ml/_lib/ml-chip-proxy.js` — chama via playwright
com storage state salvo. Cache 30s. Fail-open.

**Resultado inicial:** batia 1:1 (`today=5, upcoming=132, in_transit=6, finalized=4`).

**Problema descoberto depois:**
1. O valor retornado pelo endpoint **depende do parâmetro `filters`**
   na query — chamar com `filters=TAB_TODAY` retorna um valor,
   `filters=TAB_NEXT_DAYS` retorna outro. Não é estável sem conhecer
   exatamente qual combinação usar.
2. O storage state expira em horas — gera 403 quando sessão cai.
   Requer rotação manual via `scripts/refresh-ml-session.mjs`.

**Status atual:** DESATIVADO por default. Ativar com
`ENABLE_ML_CHIP_PROXY=true` no env do container.

## Estado de produção hoje (2026-04-24)

- **Classifier local ativo** (fallback quando proxy off)
- Commit em produção: `d59bcf8` + desativação do proxy
- Concordância com ML: ~95-98% nos chips (bate melhor em upcoming,
  gap maior em today e in_transit)

## Endpoints importantes

### Nossa API
- `/api/ml/live-chip-buckets` → JSON com `counts`, `counts_local`,
  `chip_source`, `order_ids_by_bucket`
- `/api/ml/dashboard` → payload completo do dashboard

### ML (público)
- `GET /orders/search?seller={id}&shipping.status={X}` — lista pedidos
- `GET /shipments/{id}` — status do shipment
- `GET /items/{id}` — detalhes do item (thumbnail)

### ML (interno via proxy)
- `POST /vendas/omni/lista/api/channels/event-request` com body JSON
  descrevendo a request real. Requer cookies sessão + CSRF.
- `x-scope: tabs-mlb` pra tabs/chips

## Como chamar o endpoint interno do ML (se quiser retomar)

1. Garantir que storage state está válido:
   ```bash
   node scripts/refresh-ml-session.mjs  # segue prompts pra login
   ```
2. Código de referência: `api/ml/_lib/ml-chip-proxy.js`
3. Script de teste: `/tmp/test-chip-variants.mjs` (testa cada filter)
4. Pra ativar em produção: env `ENABLE_ML_CHIP_PROXY=true`

## Próximos passos possíveis

1. **Investigar qual `filters` retorna os 4 counts "estáveis"** — pode
   ser que `filters=""` (vazio) retorne o snapshot certo.
2. **Implementar refresh automático do storage state** (cron que
   detecta 403 e re-autentica).
3. **Alternativa: usar a lista HTML SSR** — o scraper já faz isso, e
   o `counters` retornado (`extractCountersFromXhrs`) agrega XHRs de
   várias navegações pegando o maior count de cada tab. Isso batia
   antes: 5/124/6/4.
4. **Aceitar o classifier local** como está — 96% de concordância é
   bom o suficiente pro operador.

## Arquivos relacionados

### Código
- `api/ml/dashboard.js` — classifier + `fetchMLLiveChipBucketsDetailed`
- `api/ml/_lib/ml-chip-proxy.js` — proxy do endpoint oficial (desativado)
- `api/ml/_lib/seller-center-scraper.js` — scraper visual do Seller Center
- `api/_lib/business-days.js` — feriados brasileiros (afeta today/upcoming)

### Testes
- `src/test/mlDashboardBuckets.test.ts` — 32 testes do classifier
- `src/test/businessDays.test.ts` — 9 testes dias úteis

### Docs
- `docs/ml-classification-reference.md` — mapping completo ss×sss→bucket
- `docs/ml-bricks-reverse-engineered.md` — bricks do Seller Center
- Este arquivo — histórico das 5 iterações

### Audit data (gitignored)
- `tmp-ml-audit/` — primeiros screenshots visuais
- `tmp-ml-audit2/` — captura completa das 4 abas com orders
- `tmp-ecoferro-audit/` — dump do nosso dashboard
- `tmp-xhr/` — XHRs capturados do ML (endpoint oficial)

## Commits desta sessão (em ordem cronológica)

```
2995a80 fix(scraper): chromium is not defined
953bede debug(webhook): log estruturado de rejeicao com diag
1dc176b fix(ui): cards Coleta | Sabado/Domingo/feriado
92d52b5 fix(ui): blacklist de pills invalidos
86615b7 feat(etiqueta): novo layout padrao Ecoferro
28b322f feat(classifier): 1a auditoria (revertida)
5985485 feat(classifier): 2a auditoria (revertida)
e7fb12a feat(classifier): 3a auditoria (revertida)
1eb9168 Revert 3a auditoria
e7cf491 Revert 2a auditoria
afabf11 Revert 1a auditoria
2a0252f feat(classifier): 4a auditoria via screenshots
be69d9a tune(classifier): gate shipped 7d→3d
d59bcf8 feat(chips): ml-chip-proxy 1:1 (ativo)
<este> chore: desativa chip-proxy por default + doc
```

---

**Autor:** auditoria colaborativa com 3 agentes paralelos
(researcher, general-purpose, code-analyzer) coordenados por
claude-flow.
