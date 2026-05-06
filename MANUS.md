# Instruções para o Agente Manus

**IMPORTANTE:** Antes de executar qualquer tarefa neste repositório, SEMPRE leia os seguintes arquivos de memória para obter contexto completo do sistema:

1. `docs/SYSTEM-MEMORY.md` — Visão geral, histórico de evolução e decisões arquiteturais
2. `docs/CHANGELOG.md` — Versão atual e histórico de mudanças
3. `docs/sessions/` — Últimas sessões de trabalho (ler a mais recente)

## Regras de Operação

- Após concluir qualquer alteração, SEMPRE registrar uma nova sessão em `docs/sessions/YYYY-MM-DD-descricao.md` com: problema, diagnóstico, correção e validação.
- Atualizar `docs/SYSTEM-MEMORY.md` se houver mudanças arquiteturais significativas.
- Atualizar `docs/CHANGELOG.md` se houver nova versão/release.
- Todos os arquivos em `docs/` devem manter formato Obsidian (frontmatter YAML, wikilinks, tags).

## Stack do Projeto

- **Frontend**: React + TypeScript + Vite + shadcn/ui
- **Backend**: Node.js + Express
- **Database**: SQLite (volume Docker)
- **Infra**: Coolify + VPS
- **Integração**: Mercado Livre (OAuth + HTTP Fetcher)
- **Multi-Seller**: EcoFerro (default) + Fantom (connection_id=fantom)

## Endpoints Úteis para Diagnóstico

- `https://vendas.ecoferro.com.br/api/ml/admin/test-http-fetcher` — Testa HTTP Fetcher EcoFerro
- `https://vendas.ecoferro.com.br/api/ml/admin/test-http-fetcher?connection_id=fantom` — Testa HTTP Fetcher Fantom
- `https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state` — Upload cookies EcoFerro
- `https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state?connection_id=fantom` — Upload cookies Fantom
