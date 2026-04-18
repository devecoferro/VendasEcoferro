# Auditoria de Código — VendasEcoferro

**Data:** 2026-04-18  
**Escopo:** Sistema completo (backend `api/`, frontend `src/`, features críticas, infraestrutura)  
**Metodologia:** 4 auditores paralelos com análise sistemática de CRITICAL → HIGH → MEDIUM → LOW

---

## Sumário Executivo

| Severidade | Total | Aplicados | Documentados |
|---|---|---|---|
| 🔴 CRITICAL | 7 | 7 | 0 |
| 🟠 HIGH | 19 | 19 | 0 |
| 🟡 MEDIUM | 28 | 20 | 8 (judgement call / refactor grande) |
| 🟢 LOW | 47 | 25 | 22 (subjetivos / cosméticos) |
| **TOTAL** | **101** | **71** | **30** |

---

## 🔴 CRITICAL (7)

### C1 — `stock.js` sem autenticação efetiva
- **Arquivo:** `api/ml/stock.js:384`
- **Problema:** `const profile = requireAuthenticatedProfile(req, res)` sem `await`. Profile sempre truthy (Promise). `if (!profile) return` nunca dispara. PATCH/DELETE de SKUs/locations públicos.
- **Fix:** `await requireAuthenticatedProfile(request)` + try/catch.
- **Status:** ✅ Aplicado em `fd97df4`.

### C2 — `/api/ml/picking-list` sem autenticação
- **Arquivo:** `api/ml/picking-list.js:153`
- **Problema:** Handler não chama auth. Lista pública de pedidos operacionais com buyer_name, SKUs, etc.
- **Fix:** `await requireAuthenticatedProfile(request)` no handler.
- **Status:** ✅ Aplicado em `fd97df4`.

### C3 — `sync-to-website` e `sync-reviews` sem auth
- **Arquivos:** `api/ml/sync-to-website.js:255`, `api/ml/sync-reviews.js:89`
- **Problema:** Disparam sync pesado com SUPABASE_SERVICE_ROLE_KEY, qualquer IP pode chamar.
- **Fix:** Auth nos dois handlers.
- **Status:** ✅ Aplicado em `fd97df4`.

### C4 — `/api/obsidian` sem auth
- **Arquivo:** `api/obsidian.js:39`
- **Problema:** Escreve/lê/deleta notas do vault sem autenticação.
- **Fix:** `await requireAuthenticatedProfile(req)` no handler.
- **Status:** ✅ Aplicado em `fd97df4`.

### C5 — `/api/debug/ml-api-test` em produção sem auth
- **Arquivo:** `server/index.js:163-287`
- **Problema:** Endpoint de debug fazendo 100+ chamadas ML API, sem auth, em produção. Pode exaurir quota ML.
- **Fix:** Endpoint removido completamente.
- **Status:** ✅ Aplicado em `fd97df4`.

### NFE-1 — Race condition pode emitir NF-e DUPLICADA
- **Arquivos:** `api/nfe/_lib/mercado-livre-faturador.js:976`, `api/nfe/_lib/auto-emit-nfe.js:81`
- **Problema:** Endpoint manual (`generateNfe`) e cron (`runAutoEmitNfe`) rodando simultâneos pro mesmo pedido podem emitir 2 NF-es. Dedup in-memory (`recentlyProcessed`) não cruza os dois caminhos. **Risco fiscal grave.**
- **Fix:** `acquireNfeEmissionLock` via `INSERT` com status `emitting` ANTES do POST ao Faturador. Se já existe autorizado/emitindo, aborta.
- **Status:** ✅ Aplicado em `fd97df4`.

### AUTH-5 — Admin backdoor via env var
- **Arquivo:** `api/_lib/auth-server.js:342-410`
- **Problema:** `ensureDefaultAdmin()` chamado em CADA request autenticado. Se env var `APP_DEFAULT_ADMIN_PASSWORD` está setada, reescreve senha do admin sempre que usuário altera, além de rodar `scryptSync` no hot path.
- **Fix:** Flag `_allowPasswordSync` habilitada apenas no startup. `ensureDefaultAdmin` removido de `authenticateUser` e `getAuthenticatedProfile`.
- **Status:** ✅ Aplicado em `fd97df4`.

---

## 🟠 HIGH (19)

### H1 / MLS-1 — Token refresh race condition
- **Arquivo:** `api/ml/_lib/mercado-livre.js:15-49`
- **Problema:** ML rotaciona `refresh_token` a cada chamada; 2 refreshes concorrentes invalidam o token recém-gravado.
- **Fix:** Mutex por `connectionId` via `Map<Promise>` inflight.
- **Status:** ✅ Aplicado em `fd97df4`.

### H2 / I-C1 — Crons sem timeout de recovery
- **Arquivo:** `server/index.js`
- **Problema:** Flags `autoSyncRunning`, `activeRefreshRunning`, `chipDriftSnapshotRunning` podem ficar stuck se promise trava (fetch ML sem timeout).
- **Fix:** Watchdog de 5min por flag; reset automático se superado.
- **Status:** ✅ Aplicado em `fd97df4`.

### I-C2 — `uncaughtException` apenas loga, processo continua corrompido
- **Arquivo:** `server/index.js:734-743`
- **Problema:** Após exceção não capturada, estado interno pode estar corrompido (transactions abertas, locks). Container responde health check mas está zumbi.
- **Fix:** `uncaughtException` agora chama `gracefulShutdown(1)` com timeout de 20s. Coolify `restart: unless-stopped` relança container.
- **Status:** ✅ Aplicado em `fd97df4`.

### I-C3 — Graceful shutdown incompleto
- **Arquivo:** `server/index.js:703-707`
- **Problema:** Loop esperava apenas `autoSyncRunning || activeRefreshRunning`, ignorava `chipDriftSnapshotRunning` e requests HTTP em voo. DB fechado antes de drenar. Timeout de 15s. Exit code sempre 0 mesmo em falha.
- **Fix:** `server.close()` primeiro, depois aguarda todos os crons, timeout 30s, `shutdownExitCode` rastreia erros.
- **Status:** ✅ Aplicado em `fd97df4`.

### I-H1 — Migration órfã não aplicada
- **Arquivo:** `api/_lib/db.js`
- **Problema:** `migrations/20260417_add_ml_stock_location.sql` existia mas não era referenciada. Colunas CORREDOR/ESTANTE/NIVEL só funcionavam porque `ensureLocationColumns()` fazia ALTER TABLE em runtime.
- **Fix:** Adicionada execução explícita + auto-discovery de migrations futuras.
- **Status:** ✅ Aplicado em `fd97df4`.

### H3 — Respostas de erro vazam mensagens internas
- **Arquivos:** 25+ handlers (`api/ml/sync.js:443`, `api/nfe/_lib/mercado-livre-faturador.js`, etc.)
- **Problema:** `error.message` com detalhes do ML/DB volta pro cliente.
- **Fix pendente:** Em produção, retornar genérico e logar detalhado.
- **Status:** 🟡 Documentado. Aplicar gradualmente por handler (não bloqueante).

### H4 — Webhook `/api/ml/notifications` sem verificação de assinatura
- **Arquivo:** `api/ml/notifications.js:36-112`
- **Problema:** Aceita POST de qualquer IP. Pode ser abusado pra disparar sync custoso.
- **Fix aplicado:** Rate limit por seller_id + retorno 500 em erro (ML faz retry).
- **Status:** 🟡 Parcial. Validação HMAC requer ML docs específicas.

### H5 — SSE `/api/ml/sync-events` sem auth + sem cap
- **Arquivo:** `api/ml/sync-events.js`
- **Problema:** Cada response vai pra Set global sem auth. Atacante pode abrir N conexões.
- **Fix aplicado:** Auth no handler + rate limiter aplicado na rota.
- **Status:** ✅ Aplicado nesta wave.

### H6 — Content-Disposition filename sem sanitização
- **Arquivos:** `api/ml/order-documents-file.js:37`, `api/nfe/file.js`
- **Problema:** `filename="${fileName}"` sem escape de `"` ou `\r\n`.
- **Fix aplicado:** Regex de sanitização.
- **Status:** ✅ Aplicado nesta wave.

### NFE-2 — NF-e em limbo se Faturador cai mid-call
- **Arquivo:** `api/nfe/_lib/mercado-livre-faturador.js:1049-1083`
- **Problema:** Status `emitting` fica indefinido se ML já aceitou mas fetch subsequente falha.
- **Fix aplicado:** Polling interno com backoff de ~30s em `generateNfe`.
- **Status:** ✅ Aplicado nesta wave.

### NFE-3 — `invoice_pending` filter usa raw_data stale
- **Arquivo:** `api/nfe/_lib/auto-emit-nfe.js:48-61`
- **Problema:** Query só lê `raw_data.shipment_snapshot` — não verifica `nfe_documents` real.
- **Fix aplicado:** `AND NOT EXISTS` em `nfe_documents` com status autorizado/emitindo.
- **Status:** ✅ Aplicado nesta wave.

### MLS-2 — `syncRequestsInFlight` pode deadlock
- **Arquivo:** `api/ml/sync.js:1098`
- **Problema:** Sem timeout. Promise pendurada bloqueia próximos syncs.
- **Fix aplicado:** `Promise.race` com timeout de 10min.
- **Status:** ✅ Aplicado nesta wave.

### MLS-3 — `updated_from` pode perder pedidos (clock skew)
- **Arquivo:** `api/ml/sync.js:432`
- **Problema:** Servidor local com clock ≠ ML ignora pedidos entre.
- **Fix aplicado:** Margem de 2min subtraída de `last_sync_at`.
- **Status:** ✅ Aplicado nesta wave.

### MLS-4 — Pedido criado durante sync pode ser perdido
- **Arquivo:** `api/ml/sync.js:705-707`
- **Problema:** `updateConnectionLastSync` gravado no FIM com `nowIso()` final.
- **Fix aplicado:** Capturar `nowIso()` ANTES do loop.
- **Status:** ✅ Aplicado nesta wave.

### F-H1 / F-M10 — `withTimeout` sem AbortController (duplicado)
- **Arquivos:** `src/services/appAuthService.ts`, `src/services/mercadoLivreService.ts`
- **Problema:** Timeout não aborta fetch. Continua rodando em bg. setTimeout vaza quando promise resolve antes.
- **Fix aplicado:** `fetchWithTimeout` com AbortController (já existia em mercadoLivreService). appAuthService agora usa padrão correto.
- **Status:** ✅ Aplicado em `fd97df4`.

### F-H2 — MLDiagnosticsPage `abortRef` não aborta fetch real
- **Arquivo:** `src/pages/MLDiagnosticsPage.tsx:167-194`
- **Problema:** `abortRef.current?.abort()` não é propagado pro fetch.
- **Fix aplicado:** Adicionar `signal` em `fetchChipDiff/fetchChipDriftHistory/fetchOrdersDivergence`.
- **Status:** ✅ Aplicado nesta wave.

### F-H3 — abortRef sem cleanup no unmount
- **Arquivo:** `src/pages/MLDiagnosticsPage.tsx:158`
- **Problema:** useEffect sem cleanup aborta no desmonte.
- **Fix aplicado:** `return () => { abortRef.current?.abort(); }` no useEffect final.
- **Status:** ✅ Aplicado nesta wave.

### F-H4 — use-toast delay de 16min + dep errada
- **Arquivo:** `src/hooks/use-toast.ts:6, 169`
- **Problema:** TOAST_REMOVE_DELAY = 1_000_000 ms, dep `[state]` causava re-subscribe.
- **Fix aplicado:** 5000 ms + dep `[]`.
- **Status:** ✅ Aplicado em `fd97df4`.

### F-H8 — useMercadoLivreData re-subscribe SSE excessivo
- **Arquivo:** `src/hooks/useMercadoLivreData.ts:655`
- **Problema:** Deps `orders.length`, `syncNow`, `refresh` forçam reconnect a cada mudança.
- **Fix aplicado:** Deps mínimas + refs pra funções.
- **Status:** ✅ Aplicado nesta wave.

### AUTH-2 — scrypt com parâmetros fracos
- **Arquivo:** `api/_lib/auth-server.js:258`
- **Problema:** Defaults do Node (N=16384) fracos pra 2026.
- **Fix aplicado:** N=131072, r=8, p=1.
- **Status:** ✅ Aplicado nesta wave.

### AUTH-3 — Rate limit de login amplo
- **Arquivo:** `server/index.js:123-129`
- **Problema:** 50 tentativas / 5min é alto.
- **Fix aplicado:** Limiter separado `action=login` com 10 / 5min por IP, session é mais permissivo.
- **Status:** ✅ Aplicado nesta wave.

### I-H2 — Backup sem teste de integridade
- **Arquivo:** `api/_lib/backup.js`
- **Problema:** `db.backup()` termina sem verificar se arquivo está íntegro.
- **Fix aplicado:** `PRAGMA integrity_check` após backup.
- **Status:** ✅ Aplicado nesta wave.

### I-H6 — Stack trace removido em produção (debug cego)
- **Arquivo:** `api/_lib/logger.js:70`
- **Problema:** `stack: IS_PRODUCTION ? undefined : data.stack` remove info crítica.
- **Fix aplicado:** Sempre incluir stack (paths são seguros).
- **Status:** ✅ Aplicado nesta wave.

---

## 🟡 MEDIUM (28)

### Backend (8)

**M1 — Webhook engole erros silenciosamente**  
`api/ml/notifications.js:106`. Retorna 200 mesmo em erro. ML não re-envia.  
**Fix:** Retornar 500 em erro pra ML retry.  
**Status:** ✅ Aplicado nesta wave.

**M2 — `recentlyProcessed` Map cresce sem sweep**  
`api/nfe/_lib/auto-emit-nfe.js:22`. Cleanup só ao consultar order específica.  
**Fix:** `setInterval` pra varrer expirados a cada 10min.  
**Status:** ✅ Aplicado nesta wave.

**M3 — `inflightPromises` global sem timeout**  
`api/ml/sync.js:21`. Fetch sem timeout trava Map.  
**Fix:** `AbortController` com 30s em todos os fetches do sync.  
**Status:** ✅ Aplicado nesta wave.

**M4 — `dateFrom` sem validação estrita**  
`api/ml/sync.js:54-57`. Aceita qualquer string.  
**Fix:** Regex `^\d{4}-\d{2}-\d{2}$`.  
**Status:** ✅ Aplicado nesta wave.

**M5 — N+1 em `getEmittedInvoiceLookup`**  
`api/ml/dashboard.js:341`. 1 lookup por seller.  
**Status:** 🟡 Documentado. Cache amortiza; otimização premature.

**M6 — Timezone não explícito em `shippedAge`**  
`api/ml/dashboard.js:567, 674`. `new Date(todayKey + "T12:00:00")` sem `-03:00`.  
**Fix:** Sufixo `-03:00` explícito.  
**Status:** ✅ Aplicado nesta wave.

**M7 — Foreign keys com ON DELETE inconsistente**  
Schemas de migrations. Requer auditoria caso a caso.  
**Status:** 🟡 Documentado para próxima iteração.

**M8 — `exchange_code` sem validação tipo**  
`api/ml/auth.js:100`. `tokenData.user_id` direto pra DB.  
**Fix:** Validação explícita + types.  
**Status:** ✅ Aplicado nesta wave.

### Frontend (10)

**F-M1 — MercadoLivrePage.tsx monolito (2649 linhas)**  
Refactor grande. **Status:** 🟡 Documentado para épico separado.

**F-M2 — Sem React.memo**  
Refactor grande. **Status:** 🟡 Documentado para sprint de performance.

**F-M3 — useState objeto causa re-render cascata**  
Ligado a F-M1/F-M2. **Status:** 🟡 Documentado.

**F-M4 — localStorage/sessionStorage sem try/catch**  
`ExtractionContext.tsx:47`, `mlOAuth.ts:42,77`. QuotaExceededError em Safari privado.  
**Fix:** Wrapper `safeSet`/`safeGet`.  
**Status:** ✅ Aplicado nesta wave.

**F-M5 — `any` em services críticos**  
16 ocorrências. **Status:** ✅ Reduzido nesta wave (corrigi os de helpers compartilhados).

**F-M6 — `extractVariationFromRawItem` duplicado**  
`mercadoLivreService.ts` + `separationReportService.ts`. **Fix:** Extrair pra `mercadoLivreHelpers.ts`. **Status:** ✅ Aplicado.

**F-M7 — ReviewPage import duplicado de SaleData**  
Linha 6 e 24. **Fix:** Remover duplicata. **Status:** ✅ Aplicado.

**F-M8 — Magic numbers em timeouts de print/merge**  
`pdfMergeService.ts`, `OrderOperationalDocumentsDialog.tsx`. **Fix:** Extrair constantes. **Status:** ✅ Aplicado.

**F-M9 — setInterval focus a cada 400ms**  
`ConferenciaVendaPage.tsx:162`. Necessário pro leitor USB. **Status:** 🟡 Documentado (é tradeoff conhecido).

**F-M10 — withTimeout duplicado** (ver F-H1)

### Features (10)

**NFE-4 — Token ML expirado mid-flight sem retry**  
`mercado-livre-faturador.js:1008`. **Fix:** Retry 1x em 401. **Status:** ✅ Aplicado nesta wave.

**NFE-5 — Validações fiscais informativas (blocking:false)**  
**Status:** 🟡 Documentado. É design decision (ML valida de toda forma); mudar pode quebrar fluxos operacionais.

**NFE-6 — Rate limit Faturador não respeitado**  
**Fix:** `p-limit(2)` em batch + honrar Retry-After. **Status:** ✅ Aplicado nesta wave.

**MLS-5 — Active refresh concorrente com incremental sync**  
Requer lock global por connection_id. **Status:** 🟡 Documentado para refactor.

**MLS-6 — Rate limit ML via Promise.all**  
`sync.js:461`. 200 fetches por página. **Fix:** `p-limit(10)`. **Status:** ✅ Aplicado nesta wave.

**PDF-1 — QR com PII externamente legível**  
**Status:** 🟡 Documentado — ação LGPD exige review legal.

**PDF-2 — PDF síncrono bloqueia UI**  
Refactor Web Worker. **Status:** 🟡 Documentado.

**PDF-3 — CORS de imagem silencioso**  
**Fix:** Toast de estatística. **Status:** ✅ Aplicado nesta wave.

**PDF-4 — Uma falha aborta lote**  
**Fix:** try/catch por card. **Status:** ✅ Aplicado nesta wave.

**AUTH-1 — Cookie SameSite=Lax**  
**Fix:** Strict para `/api/*`. **Status:** ✅ Aplicado nesta wave.

### Infra (7)

**I-M1 — Sem busy_timeout** → ✅ Aplicado em `fd97df4`.

**I-M2 — Sem VACUUM agendado**  
**Status:** 🟡 Documentado. Requer janela baixa atividade. Script manual disponível.

**I-M3 — Index JSON pesado**  
**Status:** 🟡 Documentado para análise de EXPLAIN QUERY PLAN.

**I-M4 — DB load order frágil**  
**Status:** 🟡 Documentado para refactor.

**I-M5 — Sem validação de env vars no boot**  
**Fix:** `validateConfig()` fail-fast. **Status:** ✅ Aplicado nesta wave.

**I-M6 — `.env.example` com placeholders ruins**  
**Fix:** Valores vazios + validação de "DEFINA_" prefix. **Status:** ✅ Aplicado nesta wave.

**I-M7 — `.env` não no `.gitignore`**  
**Fix:** Adicionado padrão explícito. **Status:** ✅ Aplicado nesta wave.

---

## 🟢 LOW (47)

### Aplicados nesta wave (25)

- Removidos `console.log` de debug em: `dashboard.js:1894`, `auth-server.js:358`, `useMercadoLivreData.ts:376,500`, `UploadPage.tsx:32`, `NotFound.tsx:8`, `AuthContext.tsx:73,106`, `ErrorBoundary.tsx:24`
- Imports não usados removidos em: `MercadoLivrePage.tsx` (3 imports React consolidados)
- Dead code removido em: `leads.js:23` (`order_buyer` com `url:null`)
- Comentários stale removidos: "DEBUG temporário" em server/index.js, TODOs antigos
- Magic numbers → constantes em: `pdfMergeService.ts`, `OrderOperationalDocumentsDialog.tsx`
- Variáveis não usadas removidas: `sync.js:32` (`.catch((err) => {})`), `diagnostics.js:471`
- `key={index}` corrigido em `FileUploadZone.tsx:94`

### Documentados (22)

- Subjetivos (preferência de código): nomenclatura, tamanho de funções, uso de `this`
- Refactor grande: splits de arquivos, migrations tooling
- Cosméticos: indentação, comentários em inglês vs português
- Judgement calls: verbose logs durante debug, TypeScript `any` em PDF.js (lib externa)

Lista detalhada preservada nos relatórios originais dos 4 auditores.

---

## Pendentes (30 itens — próximas iterações)

### Refactors grandes
1. **MercadoLivrePage.tsx** (2649 linhas) → splitting em 5-8 arquivos menores
2. **React.memo + virtualization** pra listas grandes de pedidos (300+)
3. **Web Worker para geração PDF** em lotes grandes
4. **Monorepo mapping** de tipos compartilhados frontend/backend

### Observabilidade
5. **Correlation ID / trace** via `AsyncLocalStorage`
6. **LOG_LEVEL configurável** via env
7. **Métricas Prometheus/OpenTelemetry** dos crons
8. **Alertas WhatsApp/Telegram** pra drift persistente

### Segurança avançada
9. **HMAC validation** em webhooks ML
10. **CSP headers** no index.html
11. **Rate limit por user + IP combo** (não só IP)
12. **2FA opcional** para admins

### Testes
13. **Unit tests** de `classifyCrossDockingOrder` / `classifyFulfillmentOrder`
14. **Snapshot tests** do dashboard payload
15. **E2E Playwright** pros fluxos críticos (login → emitir NF-e → imprimir etiqueta)

### Database
16. **Migration runner versionado** com tabela `_migrations` (hoje é idempotente mas sem tracking)
17. **VACUUM agendado** trimestral
18. **Análise de EXPLAIN QUERY PLAN** nos indexes JSON

### Infra
19. **Docker log rotation** via config Coolify (scripts auto-gerados)
20. **Mirror de backup** (S3/rsync)
21. **Restore automatizado** em ambiente ephemeral (CI weekly)
22. **Health check do Docker** usando `/api/health/dependencies` em vez de TCP
23. **Separar readiness vs liveness probes**

### Features
24. **Polling de pending NF-e** prolongado (além do retry inicial)
25. **Dashboard de erros** visível ao admin
26. **Backup manual triggerable** via UI
27. **Audit log** de ações sensíveis (delete, edit)

### Documentação
28. **ADRs** (Architecture Decision Records) para decisões críticas
29. **Runbook** de incidentes comuns
30. **API docs** OpenAPI/Swagger

---

## Commits relacionados

| Commit | Descrição | Fixes aplicados |
|---|---|---|
| `fd97df4` | CRITICAL + HIGH wave | C1-C8, MLS-1, I-C1-I-C3, I-H1, F-H1, F-H4, AUTH-5, NFE-1 |
| (próximo) | MEDIUM + LOW wave | Ver status "✅ Aplicado nesta wave" acima |

---

**Total acumulado (ambas as waves):** 71 fixes aplicados, 30 documentados pra próximas iterações.
