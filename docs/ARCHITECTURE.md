---
title: "🏛️ Arquitetura Técnica"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - architecture
---

# 🏛️ Arquitetura Técnica

> **Objetivo**: descrever em alto nível a stack, estrutura de diretórios e fluxo de dados do sistema.

## Stack

### Frontend
- **React 18** + **TypeScript**
- **Vite** (build tool + dev server)
- **React Router v6** (rotas client-side)
- **TanStack Query** (cache de requisições)
- **shadcn/ui** + **Radix UI** (componentes primitivos)
- **Tailwind CSS** (estilização)
- **Lucide Icons** (ícones)
- **jsPDF** + **pdf-lib** (geração e manipulação de PDFs)
- **@tanstack/react-virtual** (virtualização de listas)

### Backend
- **Node.js 20** (módulos ES)
- **Express** (HTTP server)
- **better-sqlite3** (database local persistente)
- **Playwright** (scraper headless do ML Seller Center)
- **Supabase** (auth + armazenamento de alguns dados)

### Infraestrutura
- **Docker** (containerização)
- **Coolify** (deploy)
- **Volumes persistentes** (`/app/data/` sobrevive a redeploys)

## Estrutura de diretórios

```
VendasEcoferro/
├── src/                    # Frontend React
│   ├── pages/              # Telas (DashboardPage, MercadoLivrePage, etc.)
│   ├── components/         # Componentes reusáveis (AppLayout, AppSidebar, etc.)
│   ├── hooks/              # React hooks (useMercadoLivreData, useMLLiveSnapshot)
│   ├── services/           # Clientes HTTP + lógica de negócio
│   ├── contexts/           # React Context (Auth, Extraction)
│   ├── lib/                # Utilidades (version, utils)
│   └── App.tsx             # Rotas principais
│
├── api/                    # Backend Node.js (handlers HTTP)
│   ├── _lib/               # Utilidades compartilhadas (auth, db, logger)
│   ├── ml/                 # Endpoints específicos do Mercado Livre
│   │   ├── _lib/           # Scraper, classificador, helpers
│   │   └── admin/          # Endpoints admin (audit, debug, install-chromium)
│   ├── debug-reports.js    # Sistema de reports de bugs/sugestões
│   └── ...                 # Outros endpoints
│
├── server/
│   └── index.js            # Bootstrap Express + registro de rotas
│
├── scripts/                # Scripts auxiliares (audit, migrations, etc.)
│
├── public/                 # Assets estáticos (logos, imagens)
│
├── data/                   # Volume persistente (NÃO commitado)
│   ├── ecoferro.db         # SQLite database
│   ├── debug-reports/      # Reports dos usuários + screenshots
│   └── playwright/         # Storage state do scraper ML
│
├── docs/                   # 📚 Esta documentação
│
├── Dockerfile              # Build Docker
├── package.json            # Dependências + scripts NPM
└── vite.config.ts          # Configuração do Vite
```

## Fluxo de dados — visão macro

```
┌─────────────────────────────────────────────────────────────┐
│  USUÁRIO (browser)                                          │
│  └─ vendas.ecoferro.com.br                                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVIDOR (Node/Express em Docker)                          │
│                                                              │
│  ┌───────────────────────────────────────────────────┐     │
│  │  Frontend estático (build do Vite)                │     │
│  │  - index.html + JS/CSS bundles                    │     │
│  └───────────────────────────────────────────────────┘     │
│                                                              │
│  ┌───────────────────────────────────────────────────┐     │
│  │  API HTTP (/api/*)                                │     │
│  │  ├─ /api/auth           autenticação              │     │
│  │  ├─ /api/ml/*           integração Mercado Livre  │     │
│  │  ├─ /api/debug-reports  reports de bugs           │     │
│  │  └─ ...                                           │     │
│  └───────────────────────────────────────────────────┘     │
│                                                              │
│  ┌───────────────────────────────────────────────────┐     │
│  │  Scraper Playwright (headless Chromium)           │     │
│  │  Login no ML Seller Center → captura XHR → JSON   │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
             │                      │                   │
             ▼                      ▼                   ▼
    ┌────────────────┐    ┌──────────────┐    ┌────────────────┐
    │  SQLite local  │    │  Supabase    │    │  Mercado Livre │
    │  (ecoferro.db) │    │  (auth/data) │    │  (API + UI)    │
    │  volume:       │    │              │    │                │
    │  /app/data/    │    │              │    │                │
    └────────────────┘    └──────────────┘    └────────────────┘
```

## Fluxo de autenticação

1. Usuário entra em `/login`
2. Frontend envia `POST /api/auth` com username + password
3. Backend valida contra tabela `app_users` no SQLite
4. Se OK, cria sessão em `app_sessions` e seta cookie `ecoferro_session`
5. Cookie é enviado automaticamente em todas requisições subsequentes
6. Middleware `requireAuthenticatedProfile(request)` valida a sessão em cada request autenticada

## Fluxo de dados ML (integração)

### Modo 1: Nossa API ML (autenticada via OAuth)
- **OAuth**: admin autoriza a conta ML em `/mercado-livre/reconnect`
- **Sync**: a cada 5 min (cron ou manual), puxa pedidos via API pública do ML
- **Storage**: pedidos são salvos em `ml_orders` no SQLite
- **Endpoint**: `GET /api/ml/orders` → retorna pedidos do SQLite

### Modo 2: Scraper Seller Center (Fase 2 V 3.0)
- **Playwright headless** carrega `ml-seller-center.com.br/vendas/omni/lista`
- **Sessão ML** é mantida via `storage state` em `/app/data/playwright/`
- **Clicks simulados** nos tabs forçam ML a disparar XHRs grandes com lista completa
- **Endpoint**: `GET /api/ml/live-snapshot` → retorna counters + orders 1:1 com ML
- **Detalhes**: ver [ML-LIVE-SNAPSHOT.md](./ML-LIVE-SNAPSHOT.md)

## Camadas do frontend

### Hooks (camada de dados)
- `useMercadoLivreData` → pedidos da nossa API ML (SQLite)
- `useMLLiveSnapshot` → snapshot live do ML (scraper Playwright)
- `useAuth` → estado do usuário logado

### Services (camada de rede)
- `mercadoLivreService.ts` → cliente da API `/api/ml/*`
- `mlLiveSnapshotService.ts` → cliente de `/api/ml/live-snapshot`
- `debugReportsService.ts` → cliente de `/api/debug-reports`
- `pdfExportService.ts` → geração de PDFs (etiquetas, separação)

### Components
- `AppLayout` + `AppSidebar` → estrutura visual (menu lateral + header)
- `SubClassificationsBar` → cards de sub-status calculados por orders locais
- `LiveSubCardsStrip` → strip compacto com sub-cards do live snapshot (V 3.0)
- `OrderOperationalDocumentsDialog` → modal de documentos de 1 pedido

## Classificação de pedidos (chips)

### Hierarquia de fontes pros 4 chips principais (today/upcoming/in_transit/finalized)

1. **`liveSnapshot.counters`** (V 3.0) — scraper Playwright ⭐ Fonte de verdade
2. `ml_ui_chip_counts` — scraper legado
3. `ml_live_chip_counts` — nossa API ML
4. `localCounts` — classificação interna do app (fallback)

O primeiro que está disponível é usado. Se o backend retorna `liveSnapshot`, os chips são 1:1 com ML Seller Center.

## Persistência

### `/app/data/` (volume Docker, sobrevive redeploys)
- `ecoferro.db` — SQLite principal (users, orders, leads, labels printed, etc)
- `backups/` — dumps automáticos do DB
- `debug-reports/` — reports + screenshots dos usuários
- `playwright/ml-seller-center-state.json` — sessão ML do scraper
- `playwright-browsers/` — Chromium do Playwright (instalado on-demand)

### SQLite — tabelas principais
- `app_users` — usuários do sistema
- `app_sessions` — sessões HTTP (cookie)
- `ml_orders` — pedidos sincronizados do ML
- `ml_orders_cache` — cache de dados derivados
- `ml_connections` — tokens OAuth do ML

## Segurança

- **Senhas**: hash scrypt (N=16384, r=8, p=1) + salt randômico 16 bytes
- **Sessão**: cookie httpOnly + secure + sameSite=strict
- **CSRF**: o ML protege seus endpoints internos (capturamos e reusamos token)
- **Auth no Playwright scraper**: storage state criptografado só acessível ao admin
- **Auditorias de segurança** aplicadas (ver commits `902fe16`, `fd97df4`, `3be4af8`)

## Decisões técnicas importantes

### Por que SQLite em vez de Postgres?
- App single-tenant (Ecoferro)
- Volume persistente no Docker garante durabilidade
- Backups simples (cópia de arquivo)
- Sem custo extra de infraestrutura

### Por que Playwright scraper em vez de API pública do ML?
- A API pública do ML **não retorna os mesmos números** que o Seller Center UI mostra
- ML agrega internamente de forma diferente no UI (ex: pedidos "Processando CD" entram em "Envios de hoje" mesmo não sendo envios)
- A única forma de bater 1:1 com o painel que o operador vê é scraping

### Por que engenharia reversa em vez de puppeteer simples?
- Playwright é mais moderno (auto-wait, melhor API)
- Suporte a `storage state` facilita autenticação persistente
- Melhor controle de clicks e eventos
- Detecção melhor de elementos Andes UI (React)

## Performance

- **Lazy loading** de todas as páginas (`React.lazy`)
- **Manual chunks** no Vite agrupa vendors pesados (recharts, pdf-export, misc)
- **Virtual list** no Mercado Livre pra lista de ~150+ pedidos
- **Cache HTTP** em endpoints do scraper (TTL 5min)
- **Dedup de inflight requests** no hook live snapshot

## Deploy

### Coolify (auto-deploy)
- Webhook do GitHub ativado
- Push em `main` → deploy automático (nem sempre — às vezes requer Redeploy manual)
- Dockerfile multi-stage: deps → build → runtime (node:20-bookworm-slim)

### Healthcheck
- `/api/health` → `200 OK` se servidor responde
- Dockerfile tem `HEALTHCHECK` rodando a cada 30s

### Variáveis de ambiente relevantes
- `DATA_DIR` — onde salvar dados persistentes (default `/app/data/`)
- `PLAYWRIGHT_BROWSERS_PATH=/app/data/playwright-browsers` — chromium em volume
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase
- `VITE_ML_REDIRECT_URI` — URL de callback OAuth do ML

---

_Última atualização: 2026-04-20 (V 3.0)_
