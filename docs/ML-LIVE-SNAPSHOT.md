---
title: "🔬 ML Live Snapshot — Engenharia Reversa do Seller Center"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-live-snapshot
---

# 🔬 ML Live Snapshot — Engenharia Reversa do Seller Center

> Documentação técnica do sistema que captura dados 1:1 do ML Seller Center
> via scraper Playwright com clicks simulados. Entregue na **V 3.0**.

---

## Problema que resolve

A **API pública do Mercado Livre** não retorna os mesmos números que o painel do **Seller Center** mostra. Exemplo:

| Tela | "Envios de hoje" | "Próximos dias" |
|------|------------------|-----------------|
| API pública ML | 5 | 141 |
| Painel ML Seller Center | **5** | **149** |

A divergência vem de **agregações internas do ML no UI** (inclui "Processando CD", "Vamos enviar dia X", "Devolução pra revisar hoje" etc no bucket "Envios de hoje") que não são expostas pela API.

**Impacto**: o operador via números diferentes no nosso app vs. no ML — causava desconfiança e retrabalho.

**Solução**: **scraper Playwright headless** que loga no Seller Center, clica nos tabs como um humano, e captura as respostas XHR internas do ML.

---

## Arquitetura do snapshot

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Login ML (admin, uma vez)                                   │
│     → npm run setup:ml-scraper localmente                       │
│     → cria storage state em ml-seller-center-state.json         │
│     → upload via /api/ml/admin/upload-scraper-state             │
│     → ficha em /app/data/playwright/ml-seller-center-state.json │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. scrapeMlLiveSnapshot() — executado por /api/ml/live-snapshot │
│                                                                  │
│     ├─ Nav 1: abre /vendas/omni/lista?filters=TAB_TODAY         │
│     │   ├─ aguarda 10s (hidratação JS)                          │
│     │   ├─ clica input[value=TAB_NEXT_DAYS]  (2.5s delay)       │
│     │   ├─ clica input[value=TAB_IN_THE_WAY] (2.5s delay)       │
│     │   ├─ clica input[value=TAB_FINISHED]   (2.5s delay)       │
│     │   ├─ clica input[value=TAB_TODAY]      (volta, 2.5s)      │
│     │   └─ aguarda 10s final (XHRs completarem)                 │
│     │                                                            │
│     └─ Nav 2: abre /vendas/omni/lista?filters=TAB_NEXT_DAYS     │
│         └─ (mesmo fluxo, ordem diferente pra redundância)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Interceptor page.on("response", ...)                        │
│     captura event-request ~500KB por tab (SSE)                  │
│                                                                  │
│     Filtra: JSON do domínio mercadolivre.com.br, > 100 bytes,   │
│     evita analytics/CSS/telemetria.                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. extractCountersFromXhrs() + extractOrdersByTab()            │
│     normaliza brick JSON do ML → formato interno:                │
│                                                                  │
│     {                                                            │
│       counters: { today, upcoming, in_transit, finalized },     │
│       orders: { today: [...], upcoming: [...], ... },           │
│       sub_cards: { today: {...}, ... }                          │
│     }                                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Cache em memória (TTL 5min) + resposta ao frontend          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fluxo da engenharia reversa (como descobrimos)

Esta seção documenta **historicamente** como chegamos no scraper que funciona. Útil pra entender as decisões e evitar regressões.

### Fase 1 — Observação inicial

**Problema**: clicar em "Próximos dias" no ML Seller Center mostra 149 pedidos. Nossa API retornava 141 (8 a menos).

**Primeiro teste**: tentar fetch direto dos endpoints que o JS do ML usa, extraídos do HTML inicial.

```
GET /sales-omni/packs/marketshops/operations-dashboard/tabs
    ?sellerSegmentType=professional&filters=TAB_TODAY&...
Header: x-scope: tabs-mlb
```

**Resultado**: **404** em todas as variantes testadas (com/sem CSRF token, com/sem X-Requested-With).

### Fase 2 — Descoberta: simular interação

Observação importante: em **browser normal**, esses XHRs disparam quando o usuário clica num tab. Em **browser headless**, o JS de hidratação não roda completamente, então os fetches não são acionados.

**Hipótese**: simular click no tab faz o ML disparar o fetch certinho, com todos os headers internos.

**Problema**: `<button>` genérico não funciona. O ML usa **Andes Segmented Control** (framework UI do Mercado Libre), que renderiza como:

```html
<input type="radio"
       id="_r_1f_-segment-input-TAB_NEXT_DAYS"
       value="TAB_NEXT_DAYS"
       name="_r_1f_-name">
<label class="andes-segmented-control__segment"
       for="_r_1f_-segment-input-TAB_NEXT_DAYS">
  145Próximos dias
</label>
```

**Solução**:
```javascript
const radio = document.querySelector('input[type="radio"][value="TAB_NEXT_DAYS"]');
radio.click();
radio.dispatchEvent(new Event("change", { bubbles: true }));
```

### Fase 3 — Flakiness: fetches cancelados

**Problema novo**: às vezes o click funcionava, às vezes o ML cancelava o fetch pendente quando chegava o próximo click muito rápido.

**Teste 1** (600ms entre clicks): `finalized` voltou vazio.
**Teste 2** (2500ms entre clicks): `upcoming` voltou vazio.

**Hipótese**: ML usa SWR/React Query com `AbortController` que cancela request em andamento ao mudar tab.

**Solução**: **2 navegações sequenciais** com tabs iniciais diferentes. Cada tab é clicada em 2 navegações, criando redundância.

- Nav 1 abre em `TAB_TODAY` → clica outros 3 → volta em TAB_TODAY
- Nav 2 abre em `TAB_NEXT_DAYS` → clica outros 3 → volta em TAB_NEXT_DAYS

Dedup automática via `Set(pack_id)`.

### Fase 4 — Resultado final

Com **2 navegações + 4 clicks cada + 2.5s delay + 10s wait final**:

```
today:      43 pedidos ✅
upcoming:   50 pedidos ✅
in_transit: 50 pedidos ✅
finalized:  50 pedidos ✅
Total: 193 pedidos extraídos, 60 XHRs capturados
navs_successful: 2
```

Tempo total por scrape: **~60-90s**. Cache de 5min reduz impacto perceptível.

---

## Schema do snapshot

### Endpoint

```
GET /api/ml/live-snapshot          → retorna cache (5min TTL)
GET /api/ml/live-snapshot?run=1    → força scrape fresh (~90s)
```

### Response

```json
{
  "success": true,
  "from_cache": false,
  "stale": false,
  "capturedAt": "2026-04-21T00:40:37.861Z",
  "counters": {
    "today": 5,
    "upcoming": 149,
    "in_transit": 6,
    "finalized": 8
  },
  "sub_cards": {
    "today": {
      "label_ready_to_print": 0,
      "ready_for_pickup": 0,
      "with_unread_messages": 0,
      "total": 43,
      "by_status": {
        "Processando no centro de distribuição": 18,
        "Vamos enviar o pacote no dia 22 de abril": 11,
        ...
      }
    },
    "upcoming": {
      "label_ready_to_print": 37,
      "scheduled_pickup": 13,
      "total": 50,
      "by_pickup_date": {
        "22 de abril": 2,
        "23 de abril": 3,
        "24 de abril": 7
      },
      "by_status": { ... }
    },
    "in_transit": {
      "in_transit": 50,
      "total": 50,
      "by_status": {
        "A caminho": 49,
        "No ponto de retirada": 1
      }
    },
    "finalized": {
      "delivered": 47,
      "cancelled_seller": 1,
      "cancelled_buyer": 2,
      "with_claims": 0,
      "total": 50,
      "by_status": { ... }
    }
  },
  "orders": {
    "today": [
      {
        "pack_id": "2000016073556476",
        "order_id": "2000016073556476",
        "row_id": "row-2000016073556476_2000016073556476",
        "status_text": "Etiqueta pronta para impressão",
        "description": "Você deve entregar o pacote à coleta que passará na quinta-feira.",
        "priority": "normal",
        "buyer_name": "Renato Augusto D'Avila",
        "buyer_nickname": "BKWT",
        "store_label": "OURINHOS RUA DARIO ALONSO",
        "date_text": "20 abr 21:56 hs",
        "channel": "marketplace",
        "reputation_text": "Não afeta sua reputação",
        "reputation_priority": "NORMAL",
        "shipment_ids": [46897268175],
        "primary_action_text": "Imprimir etiqueta",
        "messages_unread": false,
        "new_messages_amount": 0,
        "url_detail": "https://www.mercadolivre.com.br/vendas/.../detalhe?..."
      }
    ],
    "upcoming": [ ... ],
    "in_transit": [ ... ],
    "finalized": [ ... ]
  },
  "stats": {
    "total_orders": 193,
    "tabs_with_data": ["today", "upcoming", "in_transit", "finalized"],
    "xhr_count": 60,
    "navs_successful": 2
  }
}
```

---

## Arquivos do sistema

### Backend
- **`api/ml/_lib/seller-center-scraper.js`** — scraper principal
  - `scrapeMlLiveSnapshot()` — orquestra 2 navegações
  - `scrapeMlSellerCenterFull()` — executa 1 navegação com clicks
  - `captureTabStore()` — navega + clica + intercepta
  - `extractCountersFromXhrs()` — acha brick `segmented_actions`
  - `extractOrdersFromBody()` — parseia cada `row-*`
  - `aggregateSubCards()` — gera sub_cards do status_text

- **`api/ml/live-snapshot.js`** — handler HTTP com cache

- **`api/ml/admin/live-cards-debug.js`** — endpoint diagnóstico (admin)
  - Mostra XHRs capturados, HTML matches, direct fetches tentados, DOM debug
  - Usado apenas durante desenvolvimento/troubleshooting

### Frontend
- **`src/services/mlLiveSnapshotService.ts`** — cliente com tipos TS completos
- **`src/hooks/useMLLiveSnapshot.ts`** — hook React com cache compartilhado + dedup
- **`src/components/LiveSubCardsStrip.tsx`** — strip com sub-cards por bucket
- **`src/pages/MercadoLivrePage.tsx`** — integra o hook no banner principal

---

## Manutenção: o que fazer quando quebrar

### ML muda o HTML do tab
**Sintoma**: `clicksAttempted` retorna `not_found` pros labels.
**Diagnóstico**: ver `_dom_debug` no endpoint `/api/ml/admin/live-cards-debug`.
**Fix**: ajustar seletores no `captureTabStore()` (ex: novos `data-testid`).

### ML muda o formato do event-request
**Sintoma**: `counters` volta `{ today: 0, upcoming: 0, ... }` ou `orders` vazio.
**Diagnóstico**: baixar JSON de `/api/ml/admin/live-cards-debug?run=1&tab=today&store=outros`. Procurar `segmented_actions_marketshops` no body dos XHRs.
**Fix**: ajustar `extractCountersFromXhrs()` e `extractOrdersFromBody()`.

### Sessão ML expira
**Sintoma**: scraper retorna `{ ok: false, error: "session_expired" }`.
**Fix**: admin precisa refazer o login ML:
1. Localmente: `npm run setup:ml-scraper`
2. Login manual no Chromium que abrir
3. Copiar arquivo `data/playwright/ml-seller-center-state.json`
4. Fazer upload em `/api/ml/admin/upload-scraper-state` no sistema

### Chromium não instalado
**Sintoma**: scraper retorna `{ ok: false, error: "playwright_missing" }` ou `"Executable doesn't exist"`.
**Fix**: abrir `/api/ml/admin/install-chromium` (admin) e apertar "Instalar". Instala em volume persistente `/app/data/playwright-browsers/`.

### OOM / container crash durante scrape
**Sintoma**: 502 Bad Gateway ou container reinicia.
**Fix**:
- Chromium já está otimizado (`--single-process`, `--disable-gpu`, viewport 1280x720, route blocks pra imagens/fontes)
- Se persistir, aumentar RAM da VPS ou implementar scrape incremental (1 tab por vez, 4 rodadas)

---

## Limitações conhecidas

1. **~50 pedidos por tab** (primeira página). O ML pagina em 50. Pra ver os 149 de "upcoming" completos, precisaria rodar com `offset=50`, `offset=100`, etc. Ainda não implementado.
2. **Rescrape demora ~60-90s** no pior caso (cold start). Cache minimiza impacto.
3. **Depende do ML manter a estrutura Andes Segmented Control**. Se eles refatorarem o UI, quebra.
4. **Requer admin configurar sessão ML uma vez** (storage state). Operador não consegue sozinho.

---

## Melhorias futuras (ideias)

- [ ] Paginação: varrer `offset=0,50,100,...` pra capturar 100% dos pedidos em cada tab
- [ ] WebSocket/SSE real-time: conectar no próprio canal event-request do ML ao vivo em vez de fazer scrape periódico
- [ ] Auto-renovação de sessão antes de expirar (heartbeat)
- [ ] Scrape incremental em background (cron a cada 5min) em vez de on-demand
- [ ] Alertas se divergência > X% entre nossa API e snapshot live

---

_Última atualização: 2026-04-20 (V 3.0)_
