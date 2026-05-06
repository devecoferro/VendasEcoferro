---
title: "Sessão 06/05/2026 - Correção de Hierarquia de Chips"
date: 2026-05-06
tags:
  - ecoferro
  - sessao
  - http-fetcher
  - fix
  - chips
---

# Sessão 06/05/2026 — Correção de Hierarquia de Chips

## Problema Reportado

Os chips do app (Envios de hoje, Próximos dias, Em trânsito, Finalizadas) não batiam com os números reais do ML Seller Center para ambas as contas (EcoFerro e Fantom).

## Diagnóstico

O HTTP Fetcher estava funcionando corretamente e retornando os valores exatos do ML Seller Center. O problema era no **frontend** (`MercadoLivrePage.tsx`), que tinha uma hierarquia de prioridade incorreta para exibir os chips.

A hierarquia antiga priorizava `liveSnapshot.counters` (dados do scraper Playwright, que já estava desativado e retornava cache stale) sobre `ml_ui_chip_counts` (dados frescos do HTTP Fetcher).

## Correção Implementada

Alteração no `useMemo` do frontend que define qual fonte de dados usar para os chips:

| Prioridade | Antes (incorreto) | Depois (correto) |
|:---:|---|---|
| #1 | `liveSnapshot.counters` (stale) | `ml_ui_chip_counts` (HTTP Fetcher) |
| #2 | `ml_ui_chip_counts` | `ml_live_chip_counts` (classificador OAuth) |
| #3 | `ml_live_chip_counts` | `liveSnapshot.counters` (emergência) |
| #4 | `localCounts` | `localCounts` |

## Arquivo Alterado

`src/pages/MercadoLivrePage.tsx` — linhas ~1445-1500 (bloco `useMemo` dos chipCounts).

## Commit

`d8afb65` — `fix(frontend): priorizar ml_ui_chip_counts (HTTP Fetcher) sobre liveSnapshot nos chips`

## Validação Pós-Deploy

Verificação realizada em 06/05/2026 às 09:54 (UTC-3):

| Conta | App | ML Real | Status |
|-------|-----|---------|--------|
| EcoFerro | 90 / 138 / 2 / 6 | 90 / 138 / 2 / 6 | 100% correto |
| Fantom | 59 / 58 / 4 / 7 | 59 / 58 / 4 / 7 | 100% correto |

## Lições Aprendidas

Quando o frontend tem múltiplas fontes de dados com fallback em cadeia, é essencial que a fonte mais confiável e atualizada esteja no topo da hierarquia. Fontes legadas (como o `liveSnapshot` do Playwright desativado) devem ser rebaixadas para fallback de emergência ou removidas completamente.

## Correção Adicional: Upload de Storage State

Durante o diagnóstico, também foi identificado que o storage state da EcoFerro havia sido sobrescrito com cookies da Fantom (ambos tinham 14638 bytes). O upload correto foi refeito (16321 bytes para EcoFerro, 14638 bytes para Fantom).

---
*Sessão registrada automaticamente pelo Manus AI Operator.*
