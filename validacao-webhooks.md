# Validação Webhooks Pós-Backfill (TAREFA 8)

**Data:** 2026-05-08  
**Status:** APROVADO

## Análise do Fluxo de Webhooks

O endpoint de webhooks (`/api/ml/notifications`) é multi-tenant safe por design. O fluxo é:

1. ML envia POST com `user_id` (seller_id) e `topic`
2. Backend valida `ML_WEBHOOK_SECRET` (timing-safe compare)
3. Backend resolve a conexão via `getConnectionBySellerId(sellerId)` — busca por seller_id, não por profile
4. Cache do dashboard é invalidado para aquela conexão específica (`invalidateDashboardCache(connection.id)`)
5. Sync incremental é executado para aquela conexão

## Por que é Multi-Tenant Safe

O webhook não depende de `profile_id` para funcionar. Ele resolve a conexão pelo `seller_id` que o ML envia no payload. Como cada `seller_id` mapeia para exatamente uma conexão (que por sua vez tem um `profile_id` owner), o isolamento é garantido automaticamente.

O backfill de `profile_id` não afeta o funcionamento dos webhooks porque eles nunca usaram `profile_id` para resolver a conexão — sempre usaram `seller_id`.

## Testes em Produção

| Teste | Resultado |
|-------|-----------|
| GET /api/ml/notifications (health check) | `{"status":"ok"}` |
| POST sem secret | `{"status":"error","error":"unauthorized"}` — webhook protegido |
| Cache invalidation | Funciona por connection.id (isolado por conta) |

## Conclusão

Os webhooks continuam funcionando corretamente após o backfill. O isolamento multi-tenant é garantido pelo mapeamento seller_id → connection_id, que é independente do profile_id. A invalidação de cache é feita por connection_id, garantindo que apenas o dashboard da conta afetada é atualizado.
