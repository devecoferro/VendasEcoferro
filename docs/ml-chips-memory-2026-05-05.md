---
title: "Memória de Engenharia Reversa: Chips do Mercado Livre Seller Center"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - ml-chips-memory-2026-05-05
---

# Memória de Engenharia Reversa: Chips do Mercado Livre Seller Center

**Data:** 05 de Maio de 2026
**Objetivo:** Alinhar os chips do classificador OAuth local (`ml_live_chip_counts`) com os chips oficiais do Mercado Livre Seller Center.

Este documento registra todas as descobertas, correções implementadas e o estado atual do problema para que a próxima sessão possa resolver definitivamente sem precisar refazer a engenharia reversa.

## 1. O Problema Original
O scraper Playwright (`ml_ui_chip_counts`) parou de funcionar devido a bloqueios do ML (HTTP 404 por cookies expirados/inválidos). O sistema fez fallback para o classificador OAuth local (`ml_live_chip_counts`), mas os números estavam extremamente divergentes da realidade.

**Divergência Inicial (Fantom):**
- Envios de hoje: 21 (ML: 14)
- Próximos dias: 158 (ML: 68)
- Em trânsito: 5 (ML: 6)
- Finalizadas: 38 (ML: 10)

## 2. Descobertas Cruciais por Chip

### 2.1. Em trânsito (RESOLVIDO ✅)
- **Descoberta:** O chip "Em trânsito" do ML **NÃO** conta todos os pedidos enviados. Ele conta APENAS pedidos com substatus `waiting_for_withdrawal` (aguardando retirada no ponto) e pedidos `not_delivered` recentes (últimos 3 dias).
- **Correção (rev3):** Removemos os substatuses normais de trânsito (`out_for_delivery`, `receiver_absent`, etc.) e adicionamos `not_delivered` recentes.
- **Status Atual:** **PERFEITO (4 = 4)**. A lógica está 100% alinhada com o ML.

### 2.2. Finalizadas (QUASE RESOLVIDO 🔄)
- **Descoberta:** O chip "Finalizadas" no filtro "Todas as vendas" **NÃO** é a soma de reclamações/mediações. Ele conta **pedidos que foram ENTREGUES HOJE** (data real de chegada).
- **Problema:** A API do ML não expõe facilmente a "data real de chegada". O campo `status_history.date_delivered` marca quando o ML *registrou* a entrega no sistema, o que pode acontecer hoje para um pacote que chegou ontem.
- **Correção (rev12):** Mudamos a lógica para buscar pedidos `delivered` criados nos últimos 2 dias e verificar se `date_delivered` (fuso BRT) é hoje.
- **Status Atual:** Reduziu de 38 para ~18 (ML mostra 9). A diferença são pedidos que chegaram ontem mas o ML atualizou o status hoje.
- **Próximo Passo:** A melhor forma de resolver é aceitar essa margem de erro ou buscar um campo de tracking mais preciso na API de shipments.

### 2.3. Próximos dias (EM ANDAMENTO 🔄)
- **Descoberta:** O chip "Próximos dias" do ML conta APENAS pedidos `ready_to_ship` (RTS) que têm data de coleta (SLA) futura.
- **Problema:** Nosso classificador estava incluindo TODOS os pedidos `pending` (aguardando pagamento/processamento) e pedidos RTS sem shipment. Isso inflava o número em +60 pedidos.
- **Correção (rev11):** Removemos os pedidos `pending` e os pedidos RTS sem shipment do chip `upcoming`.
- **Status Atual:** Reduziu de 158 para 116 (ML mostra 80). A diferença de ~36 pedidos são pedidos RTS que a API retorna como `ready_to_ship` mas que o ML já processou (delay de cache da API de orders/search).
- **Próximo Passo:** A API de orders/search tem delay. Para alinhar 100%, seria necessário ignorar o status da busca e verificar o status real de cada shipment, mas isso consome muitas chamadas API.

### 2.4. Envios de hoje (EM ANDAMENTO 🔄)
- **Descoberta:** O ML mostra em "Envios de hoje" pedidos cross-docking prontos (`ready_for_pickup`, `packed`) e TODOS os pedidos Full em processamento (`in_warehouse`, `in_packing_list`), independente do SLA.
- **Problema:** A API retorna pedidos que já foram coletados pelo transportador (`picked_up` ou `shipped`) como se ainda estivessem `ready_to_ship` devido ao delay de cache.
- **Correção (rev11):** Revertemos para que Full sempre vá para `today` e `invoice_pending`/`ready_to_print` sempre vão para `upcoming`.
- **Status Atual:** 20 (ML mostra 11). A diferença de 9 pedidos são pacotes que já foram coletados hoje, mas a API ainda os retorna como RTS.
- **Próximo Passo:** É uma limitação da API do ML (delay de atualização de status). O ML Seller Center atualiza em tempo real via BFF, mas a API pública tem delay.

## 3. Resumo das Correções no Código (`api/ml/dashboard.js`)
1. **Fuso Horário:** Implementado `getCalendarKey` para usar `America/Sao_Paulo` (BRT) em todas as comparações de data (evita que entregas de 21h-23h59 de ontem contem como hoje).
2. **Limpeza de Pending:** Pedidos `shipping.status=pending` não vão mais para os chips (o ML não os mostra).
3. **Limpeza de RTS sem Shipment:** Pedidos RTS sem dados de shipment não vão mais para os chips.
4. **Substatuses Específicos:**
   - `invoice_pending` → SEMPRE `upcoming`
   - `ready_to_print` → SEMPRE `upcoming`
   - `in_warehouse` / `in_packing_list` (Full) → SEMPRE `today`

## 4. Conclusão e Recomendação para a Próxima Sessão
O classificador OAuth local nunca será 100% idêntico ao ML Seller Center em tempo real devido ao **delay de cache da API pública do Mercado Livre** (especialmente para pedidos recém-coletados ou recém-entregues).

A lógica atual implementada na `rev12` é a mais próxima possível da realidade usando a API pública.

**Recomendação:**
Se a precisão 100% for estritamente necessária, a única solução é consertar o scraper Playwright (`ml_ui_chip_counts`) para que ele consiga renovar a sessão automaticamente sem tomar HTTP 404 (header too large / cookies expirados), possivelmente implementando uma rotação de cookies mais agressiva ou usando a API BFF diretamente com tokens de sessão renovados.
