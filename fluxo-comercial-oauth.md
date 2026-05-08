# Fluxo Comercial OAuth Multi-Tenant (TAREFA 7)

**Data:** 2026-05-08  
**Status:** IMPLEMENTADO E VALIDADO

## Fluxo de Onboarding de Novo Cliente

O fluxo para um novo cliente (tenant) conectar sua conta Mercado Livre ao sistema segue as etapas abaixo. Todas as etapas já estão implementadas no código em produção.

### Etapa 1 — Criação do Perfil

O administrador cria um novo perfil (profile) para o cliente via painel de Usuários. O perfil recebe um `profile_id` UUID único, username, senha, role (`operator`) e módulos permitidos.

### Etapa 2 — Login do Cliente

O cliente faz login com suas credenciais. O sistema retorna o `profile_id` na sessão autenticada.

### Etapa 3 — Autorização OAuth (get_auth_url)

O frontend chama `POST /api/ml/auth` com `action: "get_auth_url"`, enviando `redirect_uri` e `state` (mínimo 16 caracteres). O backend:

1. Valida que o `redirect_uri` está na whitelist (`APP_BASE_URL` + `ML_OAUTH_REDIRECT_ORIGINS`)
2. Registra o `state` server-side vinculado ao `profile_id` do usuário autenticado
3. Retorna a URL de autorização do Mercado Livre

O cliente é redirecionado para o ML, autoriza o acesso, e retorna com o `code`.

### Etapa 4 — Troca do Code (exchange_code)

O frontend chama `POST /api/ml/auth` com `action: "exchange_code"`, enviando `code`, `redirect_uri` e `state`. O backend:

1. Valida `redirect_uri` na whitelist
2. Consome o `state` (one-shot, previne replay)
3. Verifica que o `profileId` do state bate com o perfil autenticado
4. Troca o code por tokens no ML
5. Valida o payload do ML (user_id, access_token, refresh_token, expires_in)
6. Busca dados do seller (nickname) via API ML
7. Faz `upsertConnection` com `profile_id` do perfil autenticado (linha 292)

### Etapa 5 — Conexão Vinculada

A nova conexão é criada com `profile_id` preenchido. O cliente passa a ver apenas seus próprios dados no dashboard, orders, labels-batch, etc.

## Segurança Implementada

| Controle | Implementação |
|----------|---------------|
| State binding | Server-side, vinculado ao profile_id, TTL 10min, one-shot |
| Redirect URI whitelist | Validação contra APP_BASE_URL + env extras |
| Profile mismatch | 403 se state.profileId != profile autenticado |
| Token validation | Payload ML validado campo a campo antes de persistir |
| PKCE | Suportado (code_challenge + code_verifier) |
| profile_id automático | Sempre vinculado ao perfil que executou o OAuth |

## Resultado

Quando um novo cliente conectar sua conta ML, a conexão será automaticamente isolada ao seu perfil. Nenhuma outra ação manual é necessária para garantir o isolamento multi-tenant.
