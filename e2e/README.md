# Smoke tests (Playwright)

Tests end-to-end que validam funcionalidade crítica **contra produção**
(vendas.ecoferro.com.br por default). Rodam em ~1 min no total.

## Quando rodar

- **Manualmente** depois de deploys significativos (ex: refatorações
  grandes, mudanças na classificação de buckets, updates do live
  snapshot scraper).
- **No CI** a cada push em `main` (config futuro em `.github/workflows/`).
- **Pós-incidente** pra garantir que o hotfix resolveu.

## O que cobrem

1. Login funciona e redireciona pra dashboard
2. Página `/mercado-livre` carrega sem crashar
3. Painel "Coletas por Data" renderiza
4. Toolbar do painel tem os controles esperados (dropdowns, Buscar, Limpar)
5. Barra de ações em lote tem os 6 botões críticos (Marcar Impressas,
   Desmarcar, Gerar NF-e, Imprimir ML+DANFe, Etiquetas Ecoferro, Separacao)
6. **Regressão do PERSISTENT_CLASSIFICATION_LOGIC_BUG**: o app enxerga
   pedidos do ML (endpoint `/api/ml/diagnostics` retorna counts > 0).
   Bug historico: override ML iterava só `_orders` pós-freshness, deixando
   228+ pedidos invisiveis.

## Como rodar localmente

```bash
# Credenciais obrigatórias (usuario admin/operador de teste)
export SMOKE_USER="seu-usuario"
export SMOKE_PASSWORD="sua-senha"

# (Opcional) Testar contra ambiente diferente
# export SMOKE_BASE_URL="https://staging.ecoferro.com.br"

# (Opcional) Ver o browser rodando (debug)
# export DEBUG_SMOKE=1

npm run test:smoke
```

Se der erro de browser não instalado na primeira vez:

```bash
npx playwright install chromium
```

## Como rodar no CI

Adicionar segredos no GitHub Actions:
- `SMOKE_USER`
- `SMOKE_PASSWORD`
- `SMOKE_BASE_URL` (opcional, default = produção)

Workflow sugerido em `.github/workflows/smoke.yml` (criar depois):

```yaml
name: Smoke Tests
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:smoke
        env:
          SMOKE_USER: ${{ secrets.SMOKE_USER }}
          SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}
```

## Estrutura

```
e2e/
├── playwright.smoke.config.ts   # config dedicado (não depende do lovable)
├── smoke/
│   └── mercado-livre.spec.ts    # 4 testes smoke
└── README.md                    # este arquivo
```

## Adicionando novos smoke tests

Regra: **smoke = fast + chato de reproduzir manualmente**. Só adicionar
teste de fluxo que:
1. Roda em < 30s
2. Protege contra regressão de bug que já aconteceu em prod
3. Valida state observável (DOM ou endpoint publico), não internals

Coisas a **NÃO** colocar aqui:
- Testes de UI minuciosos (cor de botão, px de padding) — fica em
  unit/component tests
- Testes de edge cases da classificação (usar vitest + `__dashboardTestables`)
- Testes de performance/load

## Divergências em prod

Se `PERSISTENT_CLASSIFICATION_LOGIC_BUG` voltar, o teste de regressão
falha com output do endpoint `/api/ml/diagnostics` nos logs. Primeiro
passo: checar `docker logs` no VPS pra ver se o hard-heal está
escalando, depois investigar `api/ml/dashboard.js` (override ML e
`fetchStoredOrders`).
