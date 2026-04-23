# Arquivados

Scripts one-off e de debug que não são usados em produção, mantidos aqui
pra histórico/referência. Se algum destes for retomado, mover de volta
pra `scripts/`.

**Arquivados em 2026-04-23 (Sprint 3 cleanup):**

| Script | Papel histórico |
|---|---|
| `audit-buckets-v2.mjs` | Auditoria pontual de buckets (substituído por testes unitários) |
| `audit-ml-buckets.mjs` | Idem |
| `audit-upcoming-classifier.mjs` | Auditoria pontual do classifier (testes cobrem) |
| `dump-bricks.mjs` | Debug one-off do payload de bricks do ML |
| `dump-event-request.mjs` | Idem |
| `dump-list-brick.mjs` | Idem |
| `extract-scraper-orders.mjs` | Helper de debug do scraper |
| `find-orders-in-bricks.mjs` | Busca pontual em bricks |
| `inspect-list.mjs`, `inspect-snapshot.mjs`, `inspect-xhrs.mjs` | Debug helpers |
| `reverse-engineer-ml.mjs`, `reverse-engineer-ml-v2.mjs` | Substituídos por `scripts/deep-reverse-engineer-ml.mjs` |
| `scrape-and-extract.mjs` | One-off de captura |
| `trigger-scraper.mjs` | Debug helper |
| `playwright-*.js` (get-audit, process-env-test, write-test) | Testes pontuais do setup Playwright |

## Scripts ativos em `scripts/` (referência)

- `backup-db.mjs` — backup do DB (também rodado via cron no VPS)
- `backup-runtime.mjs`, `restore-runtime-backup.mjs` — backup/restore runtime
- `capture-private-seller-center-snapshots.mjs` — captura oficial
- `check-operational-status.mjs` — smoke test pós-deploy
- `debug-ml-dom-dump.mjs` — debug helper **ativo** (serve pra investigar ML)
- `deep-reverse-engineer-ml.mjs` — **principal** de engenharia reversa
- `deploy-vps.sh` — deploy automatizado
- `healthcheck-ping.mjs` — health check simples
- `inspect-live-snapshot.mjs` — inspect do snapshot live
- `measure-ml-panel-latency.mjs` — benchmark
- `migrate-supabase-to-local.mjs` — migration histórica, manter pra referência
- `playwright-save-seller-session.js`, `playwright-seller-center-capture-to-window.js`, `playwright-seller-center-live-audit.js` — fluxo oficial do scraper
- `post-deploy-panel-smoke.mjs`, `post-private-seller-audit-report.mjs` — smoke tests pós-deploy
- `print-agent.mjs` — impressão de agente
- `refresh-ml-session.mjs` — renova sessão ML
- `reset-admin-password.mjs`, `rotate-admin-password.mjs` — gestão de admin
- `run-private-seller-center-capture-production.mjs` — prod capture
- `security-audit.mjs` — audit de segurança
- `setup-ml-scraper.mjs` — setup inicial do scraper
- `verify-ml-chips.mjs` — verificação de chips ML
