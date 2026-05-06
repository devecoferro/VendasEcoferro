---
title: "Memória Técnica: HTTP Fetcher para Chips do ML Seller Center"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-http-fetcher-memory
---

# Memória Técnica: HTTP Fetcher para Chips do ML Seller Center

**Data:** 05 de Maio de 2026  
**Status:** Funcionando em produção para ambas as contas (EcoFerro e Fantom)

Este documento registra a arquitetura completa, fluxo de dados e procedimentos operacionais do HTTP Fetcher, a solução definitiva para obter os chips do Mercado Livre Seller Center com precisão 100%.

## 1. Resumo da Solução

O HTTP Fetcher substitui completamente o Playwright como mecanismo de obtenção dos chips do Seller Center. Em vez de abrir um navegador headless e simular cliques, ele faz requisições HTTP diretas à API BFF (Backend For Frontend) do Mercado Livre, usando cookies de sessão exportados previamente pelo operador.

| Aspecto | Playwright (antigo) | HTTP Fetcher (atual) |
|---------|--------------------|--------------------|
| Tempo de execução | 60-90 segundos | 2-4 segundos |
| Consumo de RAM | ~300-500 MB | ~5 MB |
| Precisão | 100% | 100% |
| Estabilidade | Frágil (bloqueios, OOM) | Estável |
| Dependência no servidor | Chromium instalado | Nenhuma (apenas `node-fetch`) |
| Manutenção | Alta (cookies expiram, headers crescem) | Baixa (cookies expiram ~30 dias) |

## 2. Arquitetura e Fluxo de Dados

O fluxo completo do HTTP Fetcher é:

**Passo 1 — Leitura do Storage State (cookies)**

O sistema lê o arquivo de cookies do disco. O path depende da conta:
- EcoFerro (default): `/app/data/playwright/ml-seller-center-state.json`
- Fantom: `/app/data/playwright/ml-seller-center-state-fantom.json`

O formato do arquivo é o `storageState` do Playwright (JSON com arrays `cookies` e `origins`).

**Passo 2 — GET na página do Seller Center**

Faz um GET em `https://www.mercadolivre.com.br/vendas/omni/lista` com os cookies no header. O objetivo é extrair o `csrfToken` do HTML retornado. O token é encontrado no JSON inline da página (campo `"csrfToken"`) ou em uma meta tag.

**Passo 3 — POST para a API BFF (event-request)**

Faz um POST para `https://www.mercadolivre.com.br/vendas/omni/lista/api/channels/event-request` com:
- Header `x-csrf-token` com o valor extraído no passo 2
- Header `Cookie` com todos os cookies da sessão
- Body: o evento extraído do HTML (contém informações sobre o estado da página)

**Passo 4 — Extração dos counters**

A resposta contém os dados dos chips em `segmented_actions_marketshops → tabs`:
- `TAB_TODAY` → Envios de hoje
- `TAB_NEXT_DAYS` → Próximos dias
- `TAB_IN_THE_WAY` → Em trânsito
- `TAB_FINISHED` → Finalizadas

## 3. Arquivos-Chave do Sistema

| Arquivo | Função |
|---------|--------|
| `api/ml/_lib/ml-chip-http-fetcher.js` | Core do HTTP Fetcher — executa o fluxo GET+POST e retorna os chips |
| `api/ml/_lib/ml-chip-proxy.js` | Proxy que usa HTTP Fetcher como fonte primária, com fallback para classificador OAuth |
| `api/ml/admin/test-http-fetcher.js` | Endpoint de diagnóstico para testar se o fetcher está funcionando |
| `api/ml/admin/upload-scraper-state.js` | Endpoint para upload dos arquivos de cookies via browser |
| `api/ml/dashboard.js` | Dashboard principal — consome o chip proxy para exibir os chips |
| `server/index.js` | Cron job que chama `fetchMLChipsViaHTTP()` a cada 2 minutos |
| `scripts/capturar-cookies-ml.mjs` | Script para o operador rodar no PC local e capturar cookies |

## 4. Procedimento de Manutenção: Renovação de Cookies

Os cookies do ML expiram periodicamente (~30 dias). Quando expiram, o HTTP Fetcher retorna erro 404 ou falha na extração do csrfToken. O procedimento para renovar é:

**No PC local do operador (Windows):**

```powershell
cd C:\captura-ml
node capturar-cookies-ml.mjs
```

O script abre um Chromium, o operador faz login no ML (com MFA se necessário), e ao pressionar ENTER o script salva o `storageState` em `ml-seller-center-state.json`.

**Upload para o servidor:**

Para a conta **EcoFerro** (default):
```
https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state
```
Arquivo: `ml-seller-center-state-ecoferro.json` (16 KB)

Para a conta **Fantom**:
```
https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state?connection_id=fantom
```
Arquivo: `ml-seller-center-state.json` (15 KB)

**IMPORTANTE:** O script `capturar-cookies-ml.mjs` gera o arquivo com o nome `ml-seller-center-state.json` independente da conta logada. O operador deve renomear para `ml-seller-center-state-ecoferro.json` se capturou com a conta EcoFerro, para evitar confusão.

## 5. Endpoints de Administração

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/ml/admin/test-http-fetcher` | GET | Testa o HTTP Fetcher para a conta default |
| `/api/ml/admin/test-http-fetcher?connection_id=fantom` | GET | Testa o HTTP Fetcher para a conta Fantom |
| `/api/ml/admin/upload-scraper-state` | GET/POST | Upload de cookies da conta default |
| `/api/ml/admin/upload-scraper-state?connection_id=fantom` | GET/POST | Upload de cookies da conta Fantom |

## 6. Troubleshooting

**Problema: `configured: false`**  
O arquivo de cookies não existe no disco. Faça o upload conforme seção 4.

**Problema: `success: false` com erro 404**  
Os cookies expiraram. Rode o script de captura novamente e faça novo upload.

**Problema: `success: false` com erro de csrfToken**  
O ML mudou o formato da página. Verificar se o HTML retornado contém o campo `csrfToken` no JSON inline ou se o ML passou a usar outro mecanismo de proteção CSRF.

**Problema: Chips mostram valores antigos**  
O cron atualiza a cada 2 minutos. Aguarde ou acesse o endpoint de diagnóstico para forçar um fetch imediato.

**Problema: Storage state da EcoFerro sobrescrito com cookies da Fantom**  
Isso aconteceu quando o upload foi feito sem `?connection_id`. Para corrigir, faça upload do arquivo correto (`ml-seller-center-state-ecoferro.json`, 16 KB) na URL sem `?connection_id`.

## 7. Estado Atual em Produção (05/05/2026 23:17 UTC)

| Conta | Arquivo | Tamanho | Cookies | Fetcher | Chips |
|-------|---------|---------|---------|---------|-------|
| EcoFerro (default) | ml-seller-center-state.json | 16321 bytes | 46 cookies, 5 origins | success: true (2.7s) | today=8, upcoming=206, in_transit=2, finalized=6 |
| Fantom | ml-seller-center-state-fantom.json | 14638 bytes | 42 cookies, 4 origins | success: true (4.1s) | today=11, upcoming=90, in_transit=4, finalized=11 |

---
*Documento gerado e mantido pelo Manus AI Operator.*
*Última atualização: 05 de Maio de 2026.*
