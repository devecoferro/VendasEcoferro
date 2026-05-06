---
title: "Plano de Implementação — Fantom Motoparts (Etiquetas Separadas)"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - fantom-labels-plan
---

# Plano de Implementação — Fantom Motoparts (Etiquetas Separadas)

**Status:** scoping / não implementado
**Branch:** `feat/fantom-motoparts-labels-plan`
**Criado:** 2026-04-28

## Objetivo

A página `/mercado-livre-fantom` hoje é só placeholder (184 linhas, comentário "Estrutura pronta para filtros, busca e geração de etiquetas da segunda conta"). Implementar geração de etiquetas separada para Fantom Motoparts, paralela ao fluxo da EcoFerro (`/mercado-livre`), sem regressão na conta principal.

## Pré-requisitos / Decisões pendentes

Antes de codar, precisamos confirmar:

1. **Conta ML separada?**
   - [ ] Fantom Motoparts tem conta ML própria (seller_id, access_token, refresh_token diferentes)?
   - [ ] Ou é mesmo seller, marca diferente?
   - Impacto: se separada, precisa OAuth flow paralelo + tabela `ml_connections` com 2 registros + scoping por seller_id em todas as queries.

2. **Sync separado?**
   - [ ] Pedidos Fantom vão pra `ml_orders` mesma tabela (com seller_id)? Ou tabela separada?
   - [ ] Cron de sync precisa rodar pros 2 sellers?
   - Recomendação: mesma tabela, scoping por seller_id (mais simples).

3. **Template de etiqueta**
   - [ ] Fantom usa mesmo template visual (logo, layout) que EcoFerro? Ou template próprio?
   - Hoje: `pdfExportService.ts` gera etiqueta com logo EcoFerro hardcoded. Precisa parametrizar OU criar `pdfExportFantomService.ts`.

4. **Estoque / Stock locations**
   - [ ] Fantom usa mesmas locations (Corredor/Estante/Nível/Local)? Ou DB de stock separado?

## Escopo da implementação (assumindo conta separada + mesma tabela + template parametrizado)

### Backend

- `api/ml/auth.js` — adicionar suporte multi-seller (parâmetro `account=ecoferro|fantom` no OAuth callback)
- `api/_lib/db.js` — migration `add_brand_to_ml_connections.sql` (col `brand` enum 'ecoferro'|'fantom')
- `api/ml/sync.js` — `runMercadoLivreSync(sellerId)` já é parametrizada — só precisa cron disparar pros 2 sellers
- `api/ml/orders.js` — adicionar query param `?brand=fantom` que filtra por `seller_id` da Fantom
- `api/ml/labels.js` — aceitar `?brand=fantom` e usar template apropriado
- `server/index.js` — cron sync rotaciona entre os 2 sellers (similar ao round-robin de scopes)

### Frontend

- `src/services/mercadoLivreService.ts` — `useMLOrders({ brand: "fantom" })`
- `src/pages/MercadoLivreFantomPage.tsx` — substituir placeholder por estrutura idêntica à `MercadoLivrePage.tsx`, mas:
  - Header com logo "Fantom Motoparts"
  - Filtros + cards + lista filtrados por `brand=fantom`
  - Botão "Imprimir etiqueta" chama `/api/ml/labels?brand=fantom`
- `src/services/pdfExportService.ts` — receber `brand` como param e variar logo/cores

### Configuração

- `.env` — adicionar `ML_FANTOM_CLIENT_ID`, `ML_FANTOM_CLIENT_SECRET`, `ML_FANTOM_REDIRECT_URI`
- `docker-compose.yaml` Coolify — exposar essas vars

## Estimativa de tempo

- Decisões pendentes resolvidas: 0.5 dia
- Backend (auth + sync + scoping): 1-2 dias
- Frontend (página + UI Fantom): 1 dia
- Template de etiqueta parametrizado: 0.5 dia
- Testes E2E + deploy: 0.5 dia
- **Total: 3.5 a 4.5 dias** (1 sprint)

## Riscos

1. **Token refresh** — se Fantom tem conta separada, refresh token loop precisa rodar pros 2 sellers; se um falha, não pode quebrar o outro
2. **Rate limit ML** — 2x o tráfego no API ML pode bater limite por seller; cron precisa intercalar
3. **Stock conflicts** — se compartilharem SKUs, etiqueta pode duplicar location
4. **Label printing race** — se usuário imprime EcoFerro + Fantom em sequência, garantir não bagunçar PDF merge

## Próximos passos

1. ~~Criar branch + plano (este doc)~~ ✓
2. **AGUARDANDO USUÁRIO**: responder pré-requisitos acima
3. Após decisões: criar branches separadas por feature (auth, sync, labels)
4. Implementar incremental (pode pra produção atrás de feature flag `APP_FANTOM_ENABLED=true`)
