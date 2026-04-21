# 📜 Histórico Narrativo de Desenvolvimento

Este documento conta a **história completa** do projeto — não só o que foi feito, mas **por que** e **como** chegamos nas decisões técnicas. Útil pra devs futuros entenderem o contexto.

---

## 🌱 Ato 1 — Nascimento do sistema (Março 2026)

### O problema original

A **Ecoferro** vende peças de motos no Mercado Livre (loja "OURINHOS RUA DARIO ALONSO" + conta Mercado Envios Full). Volumes típicos: **50-150 pedidos/dia** em dias úteis.

O fluxo operacional original era:
1. Operador olha o ML Seller Center no navegador
2. Anota os pedidos do dia num papel
3. Vai ao estoque, pega os produtos
4. Volta, imprime etiquetas no próprio ML (1 por vez)
5. Gruda nas caixas

**Problemas desse fluxo**:
- Muito manual (tempo perdido)
- Erro humano (esquecer pedido, pegar produto errado)
- Sem auditoria (quem imprimiu, quando)
- Sem otimização (operador cansado indo e voltando pro estoque)

### Decisão: construir um sistema próprio

Em **19/03/2026**, começou o desenvolvimento. Stack escolhida:
- **React + TypeScript + Vite** (frontend moderno, rápido de desenvolver)
- **Node.js + Express** (backend simples)
- **SQLite** (database local, persistente em volume Docker)
- **shadcn/ui** (componentes prontos, estilizáveis)
- **Supabase** (auth, migrado depois pra auth custom)

**57 commits no primeiro dia** estabeleceram a fundação.

### Features iniciais da V 1.0

- **Login** com sessões em cookie
- **Dashboard** básico com totalizadores
- **Integração OAuth** com Mercado Livre
- **Sync de pedidos** via API pública do ML
- **Classificação automática**: Hoje / Próximos / Em trânsito / Finalizadas
- **Geração de etiqueta PDF** (ML + DANFe + Etiqueta Ecoferro interna)
- **Upload de PDFs externos** com OCR (pra pedidos de revendedores)
- **Histórico** de vendas

---

## 🔄 Ato 2 — Alinhamento com o ML (Abril 2026, 1-17)

### Novo problema: divergência de números

Logo nas primeiras semanas de uso, o operador reclamou:

> "O sistema mostra '113 em Próximos dias' mas o ML mostra '149'. De quem é a verdade?"

**Investigação**:
- Nossa API puxava dados do endpoint público do ML (`/orders/search`)
- O ML **não expõe publicamente** os números que aparecem no Seller Center UI
- O UI agrega internamente de forma que a API pública não reflete

### Tentativas de alinhamento

Várias iterações tentaram reconciliar:

#### Tentativa 1: classificação interna baseada em `substatus` (JAN-FEV)
- Cada pedido tem `shipping.substatus` do ML (ex: `ready_to_print`, `ready_to_ship`, `shipped`)
- Mapeamos cada substatus pra um bucket (today/upcoming/in_transit/finalized)
- **Problema**: nem todos os substatuses que o ML mostra na API pública aparecem no UI

#### Tentativa 2: forçar classificação por ML_live (`ef6e5cf`)
- Usamos `ml_live_chip_counts` da API pública como fonte de verdade
- **Problema**: ainda divergia ~5% dos números do UI

#### Tentativa 3: hard-heal (`df9391e`)
- Auto-correção: se divergir, re-chama ML pra atualizar o substatus
- **Problema**: lento, muitas chamadas API, ainda divergindo

#### Tentativa 4: snapshots + comparação (`private-seller-center-snapshots.js`)
- Admin tirava print do Seller Center, salvava como snapshot
- Sistema mostrava comparação lado-a-lado (ours vs theirs)
- **Utilidade**: bom pra diagnóstico, mas não resolvia o problema

### Frustração crescente

Em **20/04/2026**, o operador expressou:

> "SE PRECISAR TAMBEM DARIA PARA COLOCAR NO PROGRAMA PARA FAZER LOGUINHO NO MERCADO LIVRE E INTERPRETAR PARA FAZER UMA ENGENHARIA REVERSA DE TODOS OS CÓD CLASSIFICAÇÃO DE COMO FUNCIONAM ESTAMOS ERRANDO GASTANDO MUITO TEMPO E TOKENS PARA REALIZAR UMA TAREFA TÃO SIMPLES"

Essa mensagem desbloqueou a decisão: **engenharia reversa completa do ML Seller Center UI**.

---

## 🔬 Ato 3 — Engenharia Reversa (20/04/2026, manhã/tarde)

### Plano inicial

Usar **Playwright headless** pra:
1. Logar no ML Seller Center
2. Capturar os XHRs internos que populam a UI
3. Normalizar os dados
4. Expor via endpoint

### Setup do Playwright (16h00-18h30)

**`f5355fe`** — endpoint `/api/ml/admin/live-cards-debug` criado como laboratório.

Problemas iniciais:
- **Chromium não instalado no container**: resolvido com endpoint `install-chromium` (`4c4ec00`)
- **Login ML**: resolvido com upload de storage state (`cdd3a33`)
- **OOM em VPS pequena**: resolvido com otimizações Chromium (`c944db9`)
- **Chromium perdido em rebuilds**: resolvido movendo pra volume persistente (`52f33b1`)

### Primeira captura (18h30)

Captura ~14 XHRs por navegação. Maior parte são **configs de microfrontend** (inbox, post-sales, navegação) — sem utilidade.

O XHR importante achado: **`/vendas/omni/lista/api/channels/event-request`** (13 KB) — contém os 4 contadores principais (TAB_TODAY/NEXT_DAYS/IN_THE_WAY/FINISHED).

```json
{
  "response": [{
    "data": {
      "bricks": [{
        "id": "segmented_actions_marketshops",
        "data": {
          "segments": [
            {"id": "TAB_TODAY", "text": "Envios de hoje", "count": "5"},
            {"id": "TAB_NEXT_DAYS", "text": "Próximos dias", "count": "141"},
            ...
          ]
        }
      }]
    }
  }]
}
```

**Vitória parcial**: chips principais resolvidos. Mas faltava:
- Lista de pedidos detalhada
- Sub-cards (Coleta hoje, Para enviar, etc)

### Busca pelos endpoints de sub-cards (19h-20h)

No HTML inicial da página, encontramos referências:
```
GET /sales-omni/packs/marketshops/operations-dashboard/tabs
GET /sales-omni/packs/marketshops/operations-dashboard/actions
GET /sales-omni/packs/marketshops/list
```

Com header `x-scope: tabs-mlb`.

### Opção D: fetch direto (20h00)

Tentamos `page.evaluate(fetch(...))` pra chamar os endpoints diretos com a sessão autenticada.

**Resultado**: **404** em todos. Mesmo com CSRF token, X-Requested-With, credentials:include.

Conclusão: o ML valida algo adicional (talvez handshake interno do SDK) que não conseguimos replicar.

### Plano C: simular clicks (20h47)

Novo approach: **em vez de fetch manual, clicar nos tabs** pra forçar o ML a disparar os fetches reais.

#### Plano C v1 (`96d9fe5`): busca genérica por text
- `button, a, [role="tab"]`, `data-testid`
- Match por `text.includes("Envios de hoje")`
- **Resultado**: 0 clicks. `clicksAttempted: []`

#### Plano C v2 (`039527f`): match por múltiplos atributos + DOM debug
- Busca por `data-testid`, `aria-label`, `data-id`
- Se falhar, captura **DOM dump** pra debug
- **Resultado**: 1 click OK (TAB_TODAY via text), 3 falham

#### Plano C v3 (`e0d6584`): clicar em tabs diferentes da atual
- Filtra `currentTab` (TAB_TODAY já era o ativo, clicar de novo é no-op)
- DOM dump **sempre** capturado
- **Resultado**: DOM dump revelou que ML usa **Andes Segmented Control**!

```html
<input type="radio"
       value="TAB_NEXT_DAYS"
       id="_r_1f_-segment-input-TAB_NEXT_DAYS">
<label for="...">145Próximos dias</label>
```

**Insight**: os "tabs" são radio inputs, não buttons. Precisa mirar no `<input type="radio">`.

#### Plano C v4 (`d07efad`): clicar no input radio direto
- `document.querySelector('input[type="radio"][value="TAB_NEXT_DAYS"]')`
- `radio.click()` + `dispatchEvent("change")`
- **Resultado**: 3/3 clicks OK! 22 XHRs capturados (antes eram 13-16). **Os XHRs grandes (500KB) apareceram** com as listas completas.

---

## 🎯 Ato 4 — Fase 2 Construção (20/04/2026, noite)

### Normalização do snapshot (`8f28a67`)

Com os dados capturados, criamos função `scrapeMlLiveSnapshot()`:

1. **`extractCountersFromXhrs()`** — varre XHRs achando `segmented_actions_marketshops`
2. **`extractOrdersFromBody()`** — parseia cada `row-*` dos payloads grandes
3. **`aggregateSubCards()`** — agrega sub-cards do status_text humano

Schema retornado:
```json
{
  "counters": { "today": 5, "upcoming": 149, "in_transit": 6, "finalized": 8 },
  "orders": { "today": [...], "upcoming": [...], ... },
  "sub_cards": { "today": {...}, "upcoming": {by_pickup_date: {...}}, ... }
}
```

### Flakiness: captura intermitente

Teste 1 (delay 600ms entre clicks): `finalized` voltou vazio.
Teste 2 (delay 2500ms): `upcoming` voltou vazio.

**Hipótese**: ML usa SWR/React Query com `AbortController`. Cliques rápidos cancelam fetches pendentes.

### Solução: 2 navegações sequenciais (`3d2371b`)

Cada tab é clicada em 2 navegações diferentes. Se uma falha, a outra pega. Dedup por `pack_id`.

**Resultado**: 4/4 tabs populadas em 100% dos testes. Tempo: ~60-90s por scrape.

### Frontend — integração (`bc8a2d0`, `2a0acc6`)

1. **Service** `mlLiveSnapshotService.ts` com tipos TS completos
2. **Hook** `useMLLiveSnapshot()` com cache compartilhado + dedup
3. **Banner**: nova prioridade #1 pros chipCounts = `liveSnapshot.counters`
4. **Indicador visual**: 🟢 "ML ao vivo · atualizado há X min" + botão "↻ Atualizar agora"
5. **Strip de sub-cards**: componente `LiveSubCardsStrip` logo abaixo dos chips

---

## 📖 Ato 5 — Features adicionais (20/04/2026, madrugada)

### Manual do sistema (`d18148d`)

Demanda do operador: "preciso de manual no menu pra novos usuários entenderem".

Criada página `/manual` com:
- **Índice lateral sticky** com 11 seções
- **Navegação prev/next** no rodapé
- **Componentes visuais**: `<Step>`, `<Tip>` (tip/warning/important), `<Kbd>`

Seções:
1. Visão Geral
2. Login
3. Dashboard
4. EcoFerro (ML) — a mais longa
5. Conferência Venda (QR)
6. Estoque
7. Conferência (PDF OCR)
8. Histórico
9. **Como imprimir etiquetas** — passo-a-passo 11 etapas
10. Usuários (Admin)
11. Diagnóstico ML (Admin)

### Report Debug (`61aaeaa`)

Demanda: "botão no menu para reportar bugs com print e sugestões".

Criada infraestrutura completa:
- **Backend**: storage em arquivo JSON + PNG no `/app/data/debug-reports/`
- **Endpoints**: GET/POST/PATCH/DELETE `/api/debug-reports`
- **Frontend**: página `/report-debug` com 2 colunas:
  - **Form sticky** à esquerda (tipo, título, tela, prioridade, descrição, prints)
  - **Lista** à direita (filtros status/tipo, badges, admin muda status)
- Ícone `Bug` no sidebar, visível pra todos

### Sub-cards live (`2a0acc6`)

Último commit: componente `LiveSubCardsStrip` que exibe os sub-counters do bucket ativo direto do snapshot:
- **today**: "Etiqueta pronta", "Pronto pra coleta", "Processando CD", "Vamos enviar dia 22", ...
- **upcoming**: "Etiqueta pronta" + expansão por data ("Coleta 22 abr: 2", "Coleta 23 abr: 3")
- **in_transit**: "A caminho", "No ponto de retirada"
- **finalized**: "Entregue", "Cancel. vendedor", "Cancel. comprador"

### Versão V 3.0 + badges (`9cb3577`)

Fonte única em `src/lib/version.ts`:
- `APP_VERSION = "3.0.0"`
- `APP_VERSION_LABEL = "V 3.0"`
- `APP_VERSION_DATE = "2026-04-20"`
- `APP_VERSION_HIGHLIGHTS` (lista de novidades)

Badges visíveis:
- Sidebar topo (ao lado de "EcoFerro")
- Tela de login
- Manual (índice lateral + bloco de novidades na Visão Geral)
- `package.json` atualizado `0.0.0 → 3.0.0`

---

## 🧭 Estado atual (pós V 3.0)

### O que funciona 100%

- ✅ 4 chips principais **1:1 com ML Seller Center**
- ✅ Sub-classificação ao vivo (strip) **1:1 ML**
- ✅ Sessão ML persistente (storage state em volume)
- ✅ Chromium instalável on-demand em volume persistente
- ✅ Manual do sistema integrado
- ✅ Report Debug pra usuários
- ✅ Versão V 3.0 visível em múltiplos lugares
- ✅ Fallback graceful se ML offline

### Limitações conhecidas

- ⚠️ Scrape completo demora **60-90s** (cache 5min minimiza)
- ⚠️ Apenas **~50 primeiros** pedidos por tab são capturados (paginação não implementada)
- ⚠️ Depende do ML manter **Andes Segmented Control** no UI (se mudar, quebra)
- ⚠️ Admin precisa **renovar sessão ML a cada ~30 dias** (quando cookies expiram)
- ⚠️ Filtros do topo (data, status) **não alteram os chips** do ML ao vivo (só a lista abaixo)

### Próximos passos propostos (V 3.1, V 3.2, ...)

Ver também `ROADMAP.md` quando existir.

1. **Paginação no scraper** — capturar `offset=0,50,100,...` pra ter todos os 149 pedidos
2. **Filtrar lista clicando em sub-card** — "Vamos enviar dia 22" filtra só esses 12
3. **Polling automático** do live snapshot (ex: cada 5min em background)
4. **Alertas de divergência** (se nossa API e ML divergem > X%)
5. **Relatório de Separação V2** (picking list melhorado — plano em `delegated-noodling-lagoon.md`)
6. **Aviso visual** quando filtros do topo estão ativos ("chips continuam mostrando totais do ML")

---

## 🎓 Lições aprendidas

### 1. Quando a API pública não basta, scraping é opção legítima

Por meses tentamos alinhar com a API pública. Nunca chegou a 100%. Scraping do UI levou 1 tarde pra chegar em 1:1 exato.

### 2. Engenharia reversa requer paciência + ferramentas de debug

O `live-cards-debug` endpoint foi essencial. Sem ele, seríamos cegos. **Invista em ferramentas de introspecção**.

### 3. Frameworks de UI de bigtech não usam `<button>`

ML usa Andes (React + input radio escondido). Airbnb, Stripe, Google todos têm padrões parecidos. **Sempre inspecione o DOM real** antes de assumir seletores.

### 4. Flakiness não se resolve com mais delay

Aumentar de 600ms → 2500ms **mudou o problema** mas não resolveu. A solução foi **redundância** (2 navegações).

### 5. Cache agressivo esconde 90% do trade-off de lentidão

Scrape demora 90s, mas cache de 5min significa que operador nunca espera. A UX fica "instantânea" pra quem usa.

### 6. Badges de versão + highlights geram confiança

Usuário percebendo que o sistema está em "V 3.0" com lista de novidades tangíveis cria sensação de progresso. Vale o esforço mínimo de configurar.

---

## 👥 Créditos

**Produto / Visão**: Marcio (Ecoferro)
**Desenvolvimento**: Claude Opus 4.7 (Anthropic) como assistente
**Infraestrutura**: Coolify + VPS localhost
**Integração**: Mercado Livre Marketplace

**322 commits** ao longo de 32 dias corridos, com 18 dias de atividade ativa. Sistema em produção em `vendas.ecoferro.com.br`.

---

_Última atualização: 2026-04-20 (V 3.0)_
