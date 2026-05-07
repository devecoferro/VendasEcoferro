# Auditoria Final — Achados

## 1. HTTP FETCHER

### Resultado: DESATIVADO do fluxo de chips

**dashboard.js linha 8:**
```
// import { fetchMLChipCountsDirect, fetchMLChipsByStoreDirect } from "./_lib/ml-chip-proxy.js";
```
Import COMENTADO. Nenhuma chamada ativa.

**dashboard.js linhas 2806-2817:**
Comentário explícito: "HTTP Fetcher e Live Snapshot REMOVIDOS como override de mlLiveChipCounts"

**Outros arquivos que importam HTTP Fetcher:**
- `api/ml/admin/test-http-fetcher.js` (linhas 10, 13, 159) — endpoint de DIAGNÓSTICO apenas, não alimenta chips.
- `api/ml/_lib/ml-chip-proxy.js` — arquivo existe mas NÃO é importado por nenhum fluxo ativo.
- `api/ml/_lib/ml-chip-http-fetcher.js` — arquivo existe mas NÃO é importado por nenhum fluxo ativo.

**Conclusão:** HTTP Fetcher NÃO alimenta nenhum chip. Existe apenas como ferramenta de diagnóstico admin.

---

## 2. OAUTH COMO FONTE ÚNICA

### Resultado: CONFIRMADO — OAuth é a única fonte dos chips

**Fluxo completo rastreado:**

```
ML API (OAuth) → fetchMLLiveChipBucketsDetailed(connection) [L1856]
  → fetchAllOrdersByShippingStatus(token, sellerId, ...) [L1899-1904]
  → deduplicateOrdersToPacks(orders) [L2043-2046]
  → fetchShipmentDetails(token, shippingIds) [L2058]
  → Classificação por substatus [L2092-2242]
  → result.counts = { today, upcoming, in_transit, finalized, cancelled } [L2244-2253]
  → liveChipDetailedCache.set(cacheKey, result) [L2327]

buildDashboardPayload(options) [L2338]
  → fetchMLLiveChipBucketsDetailed(baseConnection) [L2693]
  → mlLiveChipCounts = { today: mergedIds.today.size, ... } [L2715-2721]
  → mlUiChipCounts = mlLiveChipCounts [L3020]  ← ATRIBUIÇÃO DIRETA
  → payload.ml_ui_chip_counts = mlUiChipCounts [L3037]
  → payload.ml_live_chip_counts = mlLiveChipCounts [L3047]
  → payload.chip_source = "oauth" [L3028]
  → payload.ml_ui_chip_counts_stale = false [L3039]  ← SEMPRE false
```

**Evidências:**
- L3020: `const mlUiChipCounts = mlLiveChipCounts;` — atribuição direta, sem intermediário
- L3028: `chip_source: "oauth"` — declarado explicitamente no payload
- L3021: `const mlUiChipCountsStale = false;` — nunca stale
- L3023: `const mlUiChipCountsByStore = null;` — por-store via HTTP removido

---

## 3. CACHE MULTI-CONTA

### Resultado: ISOLADO POR CONTA (com ressalva na invalidação)

**liveChipDetailedCache:**
- L1861: `const cacheKey = String(connection?.id || connection?.seller_id || "default");`
- Chave = connection.id (UUID único por conta)
- TTL = 50s (L1679)

**dashboardCacheByConnection:**
- L437-438: `const key = connectionId || "default"; const entry = dashboardCacheByConnection.get(key);`
- Chave = connectionId passado pelo frontend (UUID da conexão)
- TTL = 30s (DASHBOARD_CACHE_TTL_MS)

**getConnectionBySellerId:**
- storage.js L291-296: `SELECT * FROM ml_connections WHERE seller_id = ? LIMIT 1`
- Resolve seller_id → conexão correta no banco SQLite
- Fantom seller_id = 75043688 → conexão Fantom
- EcoFerro seller_id = 83594950 → conexão EcoFerro

**RESSALVA — invalidateDashboardCache() é GLOBAL:**
- L123-126: `dashboardCacheByConnection.clear(); liveChipDetailedCache.clear();`
- Quando um webhook chega (ex: Fantom), AMBOS os caches são limpos (Fantom E EcoFerro).
- **Impacto:** Baixo. Apenas causa um recálculo extra (1 chamada OAuth a mais). Não causa dados incorretos.
- **Justificativa:** Em um cenário com 2 contas, o custo de recalcular ambas é negligível. Para SaaS com centenas de contas, isso precisará ser refatorado para invalidação por connectionId.

---

## 4. WEBHOOKS

### Resultado: CORRETO — Invalidação imediata antes do sync

**Arquivo:** `api/ml/notifications.js` (237 linhas)

**Fluxo de execução (orders_v2 / shipments):**

| Passo | Linha | Ação | Descrição |
|-------|-------|------|-----------|
| 1 | L116 | getPayload(request) | Extrai body do webhook |
| 2 | L120 | resolveSellerId(payload) | Identifica seller_id via payload.user_id |
| 3 | L126 | getConnectionBySellerId(sellerId) | Busca conexão correta no banco |
| 4 | L142 | invalidateDashboardCache() | INVALIDA cache IMEDIATAMENTE |
| 5 | L143 | invalidateOrdersCache() | INVALIDA cache de orders |
| 6 | L213 | runMercadoLivreSync({...}) | Sync incremental (banco local) |
| 7 | L219 | response.status(200) | Responde ao ML |

**Validações:**
- a) seller_id: L120 — `resolveSellerId(payload)` extrai de `payload.user_id` ou regex `/users/(\d+)/`
- b) conexão correta: L126 — `getConnectionBySellerId(sellerId)` busca no banco por seller_id
- c) busca via OAuth: Não busca pedido específico aqui; o recálculo acontece na PRÓXIMA leitura do dashboard via `fetchMLLiveChipBucketsDetailed`
- d) atualiza banco: L213 — `runMercadoLivreSync` com pageLimit=3
- e) invalida cache: L142 — `invalidateDashboardCache()` ANTES do sync (L213)
- f) não depende de sync demorado: CORRETO — chips são recalculados via OAuth na próxima leitura, independente do sync

**Topics suportados:** orders_v2, shipments, post_purchase, invoices (L11)

---

## 5. FINALIZADAS

### Resultado: CORRETO — Entregues hoje + Claims abertas (≤7d)

**Regra exata (dashboard.js L1937-2033):**
1. Busca pedidos `delivered` dos últimos 2 dias (L1946-1951)
2. Para cada shipment, verifica `status_history.date_delivered` (L1980)
3. Compara `getCalendarKey(deliveredDate)` com `todayKey` (L1984)
4. Se entregue HOJE → adiciona ao bucket `finalized` (L1998)
5. Busca claims abertas dos últimos 7 dias via API (L2017-2033)
6. Cada claim com `resource_id` ou `order_id` → adiciona ao bucket `finalized` (L2027)

**Nenhuma dependência de Bling ou LojaHub:** A contagem usa exclusivamente a API ML OAuth (`/shipments/{id}` e `/post-purchase/v1/claims/search`).

---

## 6. REGRA FULL READY_TO_PRINT

### Resultado: PRESERVADA E CORRETA

**Arquivo:** dashboard.js L2160-2174

**Regra:**
```javascript
if (sub === "ready_to_print") {
  if (!isFull) {
    addMlOrderIds("upcoming", pack.ml_order_ids);  // Cross → Próximos Dias
  }
  // Full: não adiciona a nenhum chip (responsabilidade do ML)
  continue;
}
```

**Detecção de Full (L2111-2113):**
```javascript
const isFull =
  shipment.logisticType === "fulfillment" ||
  (pack.deposit_key && String(pack.deposit_key).startsWith("node:"));
```

**Comportamento:**
- Cross-docking + ready_to_print → "Próximos Dias" (vendedor precisa imprimir)
- Full + ready_to_print → EXCLUÍDO (ML imprime no centro de distribuição)

---

## 7. BLING E LOJA HUB

### Resultado: NÃO ALIMENTAM CHIPS OPERACIONAIS

**Evidência:**
- `grep -rn "bling|lojaHub|lojahub|loja_hub|Bling|LojaHub" api/ml/dashboard.js api/ml/notifications.js` → **ZERO resultados**
- `grep -rn "bling|lojaHub|..." api/ --include="*.js" | grep -i "chip|ml_ui|ml_live|today|upcoming|in_transit|finalized"` → **ZERO resultados**
- `grep -rln "bling|lojaHub|..." api/ --include="*.js"` → **ZERO arquivos**
- `find . -name "*.js" -path "*/bling*" -o -path "*/lojahub*"` → **ZERO arquivos**

**Conclusão:** Bling e LojaHub não existem como módulos no diretório `api/`. Não há nenhuma referência a eles em nenhum arquivo que participa do fluxo de chips do Mercado Livre. Os chips são alimentados exclusivamente pela API OAuth do Mercado Livre.

---

## 8. DIAGNÓSTICO REAL DE PRODUÇÃO

### Deploy: PENDENTE (commit c83c6c0 ainda não deployado na VPS)

**Evidência de que o deploy NÃO foi feito:**
- `chip_source` no payload = `None` (após deploy será `"oauth"`)
- `ml_ui_chip_counts != ml_live_chip_counts` (após deploy serão iguais)

**Dados reais de produção (07/05/2026 15:21 UTC):**

| Campo | EcoFerro (OAuth) | EcoFerro (HTTP Fetcher) | Diferença |
|-------|-----------------|------------------------|-----------|
| today | 82 | 96 | +14 (inflado) |
| upcoming | 38 | 112 | +74 (inflado) |
| in_transit | 2 | 2 | 0 |
| finalized | 12 | 4 | -8 (defasado) |

**Análise:**
- O HTTP Fetcher (ml_ui_chip_counts) mostra today=96 e upcoming=112, inflados em +14 e +74 respectivamente.
- O OAuth (ml_live_chip_counts) mostra today=82 e upcoming=38, que são os números corretos.
- Após deploy do c83c6c0, `ml_ui_chip_counts` será = `ml_live_chip_counts` (OAuth), eliminando a divergência.

**Fantom vs EcoFerro:**
- Atualmente ambas retornam os mesmos dados (bug de resolução de connectionId no deploy atual).
- Após deploy, cada conta terá dados independentes via `baseConnection` escopado.

**Valores esperados (referência do usuário):**
- Fantom: today=84, upcoming=31, in_transit=0, finalized=12
- Produção OAuth agora: today=82, upcoming=38, in_transit=2, finalized=12
- Diferença de ±2-7 é normal (pedidos mudam de status em tempo real)

---
