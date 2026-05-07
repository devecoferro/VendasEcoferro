# Auditoria Multi-Tenant - Mapeamento de Rotas

## Schema Atual
- `ml_connections`: NÃO tem coluna `profile_id`
- `app_user_profiles`: id, username, role (admin/operator), active
- `app_sessions`: user_id → app_user_profiles
- Não existe tabela de vínculo profile ↔ connection

## Rotas User-Facing que usam connectionId

| Arquivo | Rota | Usa connectionId? | Autenticação | Valida tenant? | Correção |
|---|---|---|---|---|---|
| api/ml/dashboard.js | GET /api/ml/dashboard | Sim (query) | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/orders.js | GET /api/ml/orders | Sim (query) | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/sync.js | POST /api/ml/sync | Sim (body) | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/stock.js | GET/PATCH/DELETE /api/ml/stock | Sim (query) | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/auth.js | GET/POST /api/ml/auth | Sim (query) | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/stores.js | GET /api/ml/stores | Não (lista todas) | requireAuthenticatedProfile | NÃO | Filtrar por profile |
| api/ml/picking-list.js | GET /api/ml/picking-list | Implícito | requireAuthenticatedProfile | NÃO | Adicionar guarda |
| api/ml/live-snapshot.js | GET /api/ml/live-snapshot | Sim (query) | NENHUMA! | NÃO | Adicionar auth + guarda |
| api/ml/conferencia.js | GET /api/ml/conferencia | Implícito | requireAuthenticatedProfile | NÃO | Verificar |
| api/ml/returns.js | GET /api/ml/returns | Não (usa latest) | requireAuthenticatedProfile | NÃO | Verificar |
| api/ml/packs.js | GET /api/ml/packs | Não (usa latest) | requireAuthenticatedProfile | NÃO | Verificar |
| api/ml/order-documents.js | GET /api/ml/order-documents | Não | requireAuthenticatedProfile | NÃO | Verificar |
| api/ml/labels.js | POST /api/ml/labels | Não | requireAuthenticatedProfile | NÃO | Verificar |
| api/ml/private-seller-center-comparison.js | GET | Não | requireAuthenticatedProfile | NÃO | Verificar |

## Rotas Internas (Webhook/System)
| Arquivo | Rota | Tipo |
|---|---|---|
| api/ml/notifications.js | POST /api/ml/notifications | Webhook ML (sem auth user) |
| api/ml/sync-events.js | GET /api/ml/sync-events | SSE (system) |

## Problema Fundamental
A tabela `ml_connections` NÃO tem coluna `profile_id`. Não existe vínculo entre perfil de usuário e conexão ML.
Para implementar multi-tenant, preciso:
1. Adicionar coluna `profile_id` na tabela `ml_connections`
2. Criar função `getConnectionForProfile(connectionId, profileId)`
3. Aplicar em todas as rotas user-facing
