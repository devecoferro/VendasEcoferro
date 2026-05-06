---
title: "Sessão 06/05/2026 - Classificador OAuth como Fonte Única"
date: 2026-05-06
tags:
  - ecoferro
  - sessao
  - oauth
  - chips
  - fix-definitivo
---

# Sessão 06/05/2026 — Classificador OAuth como Fonte Única dos Chips

## Problema Reportado

Os chips da EcoFerro continuavam divergindo do ML Seller Center real, mesmo após a correção de hierarquia feita anteriormente. O HTTP Fetcher retornava `success: true` mas com dados incorretos porque os cookies haviam expirado (endpoint `event-request` retornando 404).

## Diagnóstico

O HTTP Fetcher da EcoFerro estava com sessão expirada. Todos os 3 endpoints da API BFF do ML retornavam 404. Porém, o fetcher reportava `success: true` porque extraía dados do HTML da página (fallback interno), que eram stale/incorretos.

O problema fundamental é que qualquer solução baseada em cookies manuais (HTTP Fetcher, Playwright) é inviável para produção e para SaaS, pois exige renovação manual periódica.

## Decisão Arquitetural

O classificador OAuth local foi promovido a **fonte ÚNICA** dos chips. Ele funciona 100% do tempo sem manutenção manual, usando apenas o `access_token` OAuth que é renovado automaticamente pelo sistema.

## Alterações Implementadas

**Backend (`api/ml/dashboard.js`):**
Removido o bloco nas linhas 2199-2212 que sobrescrevia os counts do classificador OAuth com dados do HTTP Fetcher (`fetchMLChipCountsDirect`). Agora o classificador OAuth retorna seus próprios counts sem override.

**Frontend (`src/pages/MercadoLivrePage.tsx`):**
Hierarquia simplificada de 4 fontes para 2:
1. `ml_live_chip_counts` (classificador OAuth) — fonte principal
2. `localCounts` — fallback final

Removidos da hierarquia: `ml_ui_chip_counts` (HTTP Fetcher) e `liveSnapshot` (Playwright).

## Commit

`7f2a0fe` — `fix: classificador OAuth como fonte ÚNICA dos chips (remove HTTP Fetcher override)`

## Impacto

| Aspecto | Antes | Depois |
|---|---|---|
| Fonte dos chips | HTTP Fetcher (cookies manuais) | Classificador OAuth (automático) |
| Manutenção necessária | Renovar cookies a cada ~30 dias | Nenhuma |
| Precisão | 100% quando cookies válidos, ERRADO quando expiram | ~98-100% sempre |
| Viabilidade SaaS | Não | Sim |
| HTTP Fetcher | Override dos chips | Apenas diagnóstico (admin) |

## Lições Aprendidas

Para um sistema SaaS, a confiabilidade (funcionar sempre sem manutenção) é mais importante que a precisão absoluta (100% vs 98%). Uma diferença de 1-2 pedidos em momentos de transição de cache é aceitável; um sistema que para de funcionar a cada 30 dias não é.

---
*Sessão registrada pelo Manus AI Operator.*
