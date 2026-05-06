---
title: "Backup e Restauracao Operacional"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - operations-backup
---

# Backup e Restauracao Operacional

## Escopo do backup

O backup operacional do Ecoferro cobre:

- banco SQLite principal (`ecoferro.db`)
- documentos operacionais em `data/documents`
  - etiquetas externas
  - DANFE
  - XML
- opcionalmente `data/playwright`, se `BACKUP_INCLUDE_PLAYWRIGHT_STATE=true`

Observacao:

- `private_snapshot`, `nfe_documents`, `claims`, `returns`, `packs` e demais dados estruturados ja ficam dentro do banco SQLite.
- o storage state do Playwright e sensivel e so deve entrar no backup se houver uma necessidade operacional real.

## Comandos

Backup completo local:

```bash
npm run backup:runtime
```

Backup completo com espelhamento para um segundo diretorio:

```bash
BACKUP_MIRROR_DIR=/mnt/backup-ecoferro npm run backup:runtime
```

Auditoria rapida de seguranca:

```bash
npm run security:audit
```

Dry-run de restauracao:

```bash
npm run backup:restore -- "/caminho/do/backup"
```

Restauracao real:

```bash
npm run backup:restore -- "/caminho/do/backup" --confirm
```

## Estrutura gerada

Cada backup completo gera um snapshot em:

```text
data/backups/runtime/ecoferro-YYYYMMDD-HHMMSS/
```

Conteudo:

- `db/ecoferro.db`
- `documents/...`
- `playwright/...` quando habilitado
- `metadata/manifest.json`

O arquivo `latest.json` no diretorio raiz do backup aponta para o ultimo snapshot criado.

## Rotina diaria recomendada

No host/container:

```bash
cd /app
npm run backup:runtime
```

Recomendacao minima:

- 1 backup diario local
- 1 copia para um diretorio espelhado (`BACKUP_MIRROR_DIR`)
- retencao minima de 14 dias

## Restauracao segura

Antes de restaurar:

1. parar a aplicacao
2. confirmar qual snapshot sera usado
3. executar primeiro o dry-run
4. rodar a restauracao com `--confirm`
5. subir a aplicacao e validar `/api/health`

## Observacoes de seguranca

- nao versionar `.env`
- nao armazenar senha real no `.env.example`
- tratar `data/playwright/private-seller-center.storage-state.json` como credencial operacional
- preferir `BACKUP_INCLUDE_PLAYWRIGHT_STATE=false`
