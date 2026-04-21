# 📊 Métricas do Projeto

Estatísticas extraídas do histórico git. Snapshot em **2026-04-20 23:36**.

---

## Totais

| Métrica | Valor |
|---------|-------|
| **Total de commits** | 322 |
| **Dias únicos com commits** | 18 dias |
| **Arquivos TypeScript/TSX** (`src/`) | 113 |
| **Linhas de código frontend** | 25.161 |
| **Arquivos JS backend** (`api/`) | 66 |
| **Linhas de código backend** | 21.158 |
| **TOTAL de linhas de código** | **~46.300** |

---

## Período

| Marco | Data |
|-------|------|
| **Primeiro commit real** | 2026-03-19 14:44 |
| **Último commit** | 2026-04-20 23:36 |
| **Dias corridos** | 32 dias |
| **Taxa média de commits/dia ativo** | ~18 commits |

---

## Commits por dia

| Data | Commits | Foco |
|------|---------|------|
| **2026-03-19** | 57 | Kickoff — setup + features base |
| **2026-04-20** ⭐ | 47 | Fase 2 + Manual + Report Debug |
| 2026-04-16 | 34 | Integrações ML + sync |
| 2026-04-15 | 33 | Etiquetas + separação |
| 2026-04-13 | 29 | Estoque + location |
| 2026-04-17 | 25 | ML Live Sync |
| 2026-04-11 | 22 | Filtros + sumários |
| 2026-04-12 | 17 | (continuação) |
| 2026-04-14 | 13 | (continuação) |
| 2026-04-10 | 10 | Integração ML inicial |
| 2026-04-01 | 10 | Setup CI/CD |
| 2026-04-18 | 9 | Auditoria de segurança |
| 2026-03-31 | 9 | (continuação kickoff) |
| 2026-04-19 | 2 | Audit v3 |
| 2026-03-26 | 2 | Ajustes iniciais |
| 2026-04-04/05 | 1 cada | Pequenos ajustes |

---

## Distribuição por tipo de commit

Baseado em prefixos semânticos (`feat:`, `fix:`, `refactor:`, etc):

| Tipo | Aprox. |
|------|--------|
| `feat:` (novas features) | ~35% |
| `fix:` (correções) | ~40% |
| `audit:` / `security:` (auditoria) | ~5% |
| `perf:` (performance) | ~3% |
| `refactor:` | ~3% |
| `test:` | ~2% |
| `docs:` | ~2% |
| `chore:` / `style:` / outros | ~10% |

---

## Sessão atual (20/04/2026) — 47 commits

Janela: **04:34 → 23:36** (~19h ativo com pausas)

### Por categoria

| Categoria | Commits |
|-----------|---------|
| Engenharia reversa ML (scraper) | 18 |
| Fase 2 (live snapshot) | 4 |
| Manual do sistema | 1 |
| Report Debug | 1 |
| Sub-cards live (commit 3) | 1 |
| Fixes de classificação/chips | 8 |
| Estoque / etiquetas | 6 |
| Versão V 3.0 | 1 |
| Outros | 7 |

### Timeline (resumida)

| Hora | Commit | Evento |
|------|--------|--------|
| 04:34 | `4a5bccb` | Fix: Finalizadas inclui delivered/cancelled recentes |
| 08:13 | `706d772` | ML AUTHORITATIVE override |
| 14:59 | `ecf1f93` | Classificação 1:1 com ML Seller Center (sub-status + cards) |
| 16:00 | `53b8b8b` | Classificação 1:1 ML — Cancelados em today + tooltips |
| 16:20 | `f5355fe` | **Fase 1**: engenharia reversa ML — scraper FULL + debug |
| 17:26 | `cdd3a33` | Endpoint upload via browser pro storage state Playwright |
| 17:39 | `4c4ec00` | Endpoint admin pra instalar Chromium on-demand |
| 18:28 | `c944db9` | Perf: Chromium otimizado pra VPS pequena (RAM 300→80MB) |
| 19:33 | `52f33b1` | Chromium em volume persistente — sobrevive rebuilds |
| 20:20 | `7e6774a` | **Opção D**: fetch direto dos 3 endpoints internos do ML |
| 20:37 | `20d700f` | FetchDirect com CSRF token + X-Requested-With |
| 20:47 | `96d9fe5` | **Plano C**: clicar nos tabs pra forçar disparo XHRs |
| 21:15 | `039527f` | Plano C v2 — click detection + DOM debug |
| 21:34 | `e0d6584` | Plano C v3 — clicar em tab diferente da atual |
| 21:46 | `d07efad` | **Plano C v4** — radio Andes Segmented Control |
| 22:07 | `8f28a67` | **Fase 2 backend**: /api/ml/live-snapshot |
| 22:17 | `cf10e0e` | Fix: clicar nos 4 tabs |
| 22:26 | `9cefea0` | Fix: delay entre clicks 600ms → 2500ms |
| 22:33 | `3d2371b` | Fix: 2 navegações com tabs iniciais diferentes |
| 22:50 | `bc8a2d0` | **Fase 2 frontend**: banner consome live snapshot |
| 23:20 | `d18148d` | **Manual** do sistema |
| 23:29 | `61aaeaa` | **Report Debug** |
| 23:36 | `2a0acc6` | **Fase 2 Commit 3**: sub-classificações ao vivo |

---

## Densidade de código por área

| Área | Arquivos | Linhas | Linhas/arquivo média |
|------|----------|--------|----------------------|
| `src/pages/` | 15 | ~8.500 | 566 |
| `src/components/` | ~40 | ~6.000 | 150 |
| `src/services/` | 15 | ~3.500 | 233 |
| `src/hooks/` | 3 | ~700 | 233 |
| `api/ml/` | ~25 | ~12.000 | 480 |
| `api/_lib/` | ~10 | ~3.500 | 350 |
| `server/index.js` | 1 | ~300 | - |

### Maiores arquivos do projeto

1. **`src/pages/MercadoLivrePage.tsx`** — ~3.100 linhas (telão operacional com todos filtros)
2. **`src/services/mercadoLivreService.ts`** — ~1.600 linhas (cliente ML completo)
3. **`api/ml/_lib/seller-center-scraper.js`** — ~1.300 linhas (scraper Playwright + clicks + parse)
4. **`api/ml/orders.js`** — ~1.200 linhas (endpoint orders com filtros/paginação)

---

## Autor

| Autor | Commits |
|-------|---------|
| kustermarcio789 (GitHub) | 322 |

---

## Extensão do projeto

| Categoria | Valor |
|-----------|-------|
| Features principais | ~25 (ver CHANGELOG.md) |
| Endpoints HTTP expostos | 50+ (ver API-ENDPOINTS.md) |
| Páginas no frontend | 15 |
| Tabelas no SQLite | 12+ |

---

## Tempo estimado

> ⚠️ Estimativa baseada em timestamps de commits (não é time tracking oficial).

Se considerarmos ~4-6h de trabalho real por dia ativo:
- **18 dias ativos × 5h médias** = **~90h** de desenvolvimento
- Sessão de 20/04 foi a mais intensa: ~19h de janela ativa (com pausas)

---

## Comparação com projetos similares

Sistemas de gestão de e-commerce similar (benchmarks):

| Métrica | EcoFerro V 3.0 | Típico |
|---------|----------------|--------|
| Linhas de código | 46k | 30-80k (MVP-médio) |
| Endpoints | 50+ | 40-100 |
| Dias de desenvolvimento | 32 dias | 60-180 dias |
| Integrações | 2 (ML + Supabase) | 3-8 |

> Projeto enxuto e focado. Integração ML é de alta profundidade (scraping + API).

---

_Última atualização: 2026-04-20_
