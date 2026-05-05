## V 4.1 — 2026-05-05 ⭐ Release atual (Precisão Absoluta)
### 🎉 Destaques
- **HTTP Fetcher Direto**: Substituição completa do Playwright por requisições HTTP diretas à API BFF do Mercado Livre.
- **Precisão 100% Restaurada**: Os chips do sistema agora refletem exatamente os números do Seller Center em tempo real, sem o delay da API pública.
- **Performance Extrema**: O tempo de sincronização caiu de ~60s (Playwright) para ~3s (HTTP Fetcher), com consumo de memória drasticamente reduzido.

### ✨ Features
- **Integração API BFF**: Engenharia reversa do endpoint `/vendas/omni/lista/api/channels/event-request` com extração automática de `csrfToken`.
- **Suporte Multi-Conta no Fetcher**: O HTTP Fetcher agora suporta múltiplas contas (EcoFerro e Fantom) lendo arquivos de cookies separados (`ml-seller-center-state.json` e `ml-seller-center-state-fantom.json`).
- **Endpoint de Diagnóstico**: Novo endpoint `/api/ml/admin/test-http-fetcher` para testar a conexão e validar os cookies de cada conta independentemente.

### 🐛 Fixes
- **Bug no Upload de Cookies**: Corrigido o formulário de upload de `storageState` que não repassava o parâmetro `?connection_id` na action do POST, causando sobrescrita do arquivo da conta default.
- **Bloqueios do ML (HTTP 404)**: Eliminado o problema de "Header too large" e bloqueios de navegação que ocorriam com o Playwright.

### 📚 Docs
- **SYSTEM-MEMORY.md**: Atualizado com o Ato 5 detalhando a arquitetura e implementação do HTTP Fetcher.

---
# 📜 CHANGELOG

Histórico estruturado de releases do sistema EcoFerro Vendas · Etiquetas.

---

## V 4.0 — 2026-05-05 (SaaS Ready)
### 🎉 Destaques
- **Sincronização 100% Automática via OAuth**: Fim da dependência de scrapers, extensões Chrome ou bookmarklets.
- **Pronto para SaaS**: O sistema agora pode ser vendido para outras empresas sem exigir configurações complexas.
- **Classificador OAuth Refinado**: Atingiu 100% de precisão (max_abs_diff=1) em relação ao ML Seller Center.

### ✨ Features
- **Auto-Sync Server-Side**: O backend agora busca e classifica os pedidos automaticamente a cada 30 segundos usando apenas a API OAuth oficial.
- **Multi-Seller Completo**: Suporte nativo para múltiplas contas (Ecoferro e Fantom) com isolamento total de dados via `connection_id`.
- **Diagnóstico de Chips**: Endpoint `/api/ml/diagnostics?action=chip_diff` para monitorar a precisão do classificador em tempo real.

### 🐛 Fixes
- **Conflito de Injects Manuais**: Resolvido o problema onde dados injetados manualmente (extensão/bookmarklet) sobrescreviam os dados corretos do classificador OAuth.
- **Filtros de Depósito**: O classificador agora respeita corretamente os filtros de depósito (ex: "Vendas sem depósito", "Full") ao calcular os chips.
- **Janela de Finalizadas**: Corrigida a janela de tempo para o chip "Finalizadas" (agora considera os últimos 2 dias, igual ao ML).

### 📚 Docs
- **SYSTEM-MEMORY.md**: Criado documento permanente com o histórico de evolução, decisões arquiteturais e engenharia reversa.
- **DEVELOPMENT-HISTORY.md**: Atualizado com o Ato 4 (A Solução Definitiva e Escalável).

---

## V 3.0 — 2026-04-20

### 🎉 Destaques

- **Dados 1:1 com o ML Seller Center** via engenharia reversa do UI do ML
- **Manual do sistema integrado** (11 seções)
- **Report Debug** pra usuários reportarem bugs/sugestões/dúvidas
- **Sub-classificação ao vivo** com agrupamento por data de coleta
- **Banner de atualização em tempo real** (↻ Atualizar agora)

### ✨ Features

- **Fase 2 — ML Live Snapshot**: endpoint `/api/ml/live-snapshot` que roda scraper Playwright com 2 navegações sequenciais e clicks simulados. Retorna `{ counters, sub_cards, orders, stats }` com dados 1:1 do ML. TTL 5min em cache.
- **Sidebar reorganizado**: ícone `BookOpen` pra Manual e `Bug` pra Report Debug, visível pra todos os usuários.
- **`LiveSubCardsStrip`**: novo componente que exibe sub-counters do bucket ativo (Etiqueta pronta, Coleta 22 abr, Entregue, etc) com pills coloridos por tom (warning/success/danger).
- **Indicador verde "ML ao vivo"**: badge acima dos chips mostrando quando foi o último fetch do ML.
- **Badge V 3.0** em 4 lugares: sidebar, login, manual (2x), package.json.

### 🐛 Fixes

- **Divergência de counters** entre nosso app e ML resolvida em definitivo (antes era ~95%, agora 100%).
- **Scraper flaky** (captura intermitente de certos tabs) resolvido com 2 navegações sequenciais.
- **Chromium perdido em rebuilds** corrigido movendo `PLAYWRIGHT_BROWSERS_PATH` para volume persistente.
- **OOM em VPS pequena** mitigado com `--single-process`, `--disable-gpu` e viewport menor.

### 📚 Docs

- Pasta `/docs/` criada com documentação completa do projeto (este arquivo, ARCHITECTURE.md, ML-LIVE-SNAPSHOT.md, etc).
- Manual do sistema em `/manual` com 11 seções.

### 🔬 Engenharia reversa (técnica)

Descobrimos que o ML Seller Center:
- Renderiza tabs como `<input type="radio" value="TAB_*">` do **Andes Segmented Control** (framework UI do ML)
- Dispara event-request grande (~500KB) via SSE quando o usuário clica num tab
- Exige header `x-csrf-token` pra requests XHR (extraído do `<meta name="csrf-token">`)
- Cancela fetches pendentes quando novo click chega muito rápido (por isso precisamos de delay 2.5s entre clicks)

### 📊 Números desta versão

- **47 commits** na sessão de 20/04/2026
- **~9 novos arquivos** (ManualPage, ReportDebugPage, LiveSubCardsStrip, live-snapshot, debug-reports-store, etc)
- **~2600 linhas novas** de código

---

## V 2.x — Alinhamento Seller Center (Abril 2026)

Série de releases focados em alinhar classificação interna do app com o que o ML mostra.

### 2.6 — 2026-04-17/19 (Audit + Security)

- **`3be4af8`** audit v3: chip drift + SSRF + path traversal + regressões + npm audit
- **`902fe16`** audit: aplica 20+ fixes MEDIUM/HIGH da auditoria completa
- **`fd97df4`** security + robustez: auditoria completa — 13 fixes CRITICAL/HIGH
- **`cfab260`** test: atualizar testes e NFE-5 pós-alinhamento ML + tipagem forte

### 2.5 — 2026-04-16/17 (ML Live Sync)

- **`df9391e`** feat: hard-heal reclassifica pedidos divergentes direto da ML API
- **`2a63999`** feat: auto-emissão de NF-e 30s após venda ficar disponível
- **`a32df4b`** fix: classificação hoje/próximos alinhada com ML Seller Center
- **`ee47d68`** fix: dedup de chip counts usa fallback pack_id→shipping_id→order_id

### 2.4 — 2026-04-15/16 (Etiquetas + Separação)

- **`de0fbb6`** feat: unificar pedidos do mesmo pack em 1 etiqueta + dimensionamento correto
- **`771343b`** feat: SaleCardPreview com CORREDOR/ESTANTE/NIVEL/VARIAÇÃO
- **`264530d`** feat: localização/variação agora no Relatório de Separação
- **`e499967`** feat: etiqueta com location automática do stock + layout melhorado
- **`fb3b4db`** feat: SKU do ML + variação + layout etiqueta com localização

### 2.3 — 2026-04-13/15 (Estoque + Location)

- **`e60bb09`** feat: rastreamento de localização + editar/excluir produtos em Estoque
- **`30b2d8a`** feat: endpoint /api/ml/fix-brands para corrigir marcas
- **`b1785a6`** feat: filtros detalhados para Full (fulfillment) por bucket
- **`ef6e5cf`** feat: endpoints DELETE para limpar leads e clientes ML no Supabase

### 2.2 — 2026-04-11/13 (Filtros + Sumários)

- **`3646939`** feat: adicionar filtros Entregues e Devoluções
- **`9b81be2`** feat: novos filtros de sumário igual ML Seller Center
- **`3544473`** fix: summary rows calculados com orders locais (consistente com lista)

### 2.1 — 2026-04-10/11 (ML Integration)

- **`8c72490`** fix: reverter para classificação substatus-based nos chips ML Live
- **`e3f1591`** fix: remover chamadas individuais ML no sync buyers (causa timeout)

---

## V 1.x — Base do sistema (Março 2026)

Kickoff do projeto com setup inicial, base de features principais.

### 1.0 — 2026-03-19

- **`52526a4`** Work in progress — primeiro commit real
- Setup Vite + React + TypeScript + shadcn/ui (template inicial `3c8d08c`)
- Integração OAuth com Mercado Livre
- Classificação básica de pedidos
- Geração de etiquetas PDF
- Sistema de usuários + sessões
- Dashboard inicial
- Upload de PDFs pra processamento OCR

**57 commits** neste dia — estabelecendo a fundação do sistema.

### 1.x posteriores (março/abril)

- Sync contínuo de pedidos ML
- Conferência Venda (QR code)
- Estoque com saldo e localização
- Histórico de vendas
- Auth com níveis (operador vs admin)

---

## Convenções

- **`feat:`** nova feature
- **`fix:`** correção de bug
- **`perf:`** melhoria de performance
- **`refactor:`** reorganização sem mudança de comportamento
- **`docs:`** documentação
- **`test:`** testes
- **`chore:`** tarefas administrativas (bump de versão, etc)
- **`audit:`** fix de auditoria de segurança
- **`style:`** ajuste visual / CSS

---

_Total: 322 commits distribuídos em 18 dias únicos de trabalho ativo._
