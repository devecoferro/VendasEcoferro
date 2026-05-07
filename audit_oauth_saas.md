# Auditoria OAuth SaaS - Achados

## 1. Fluxo de Autorização (auth.js)

### Geração do link (get_auth_url)
- Usa ML_CLIENT_ID (mesmo para todos os clientes) ✅ CORRETO para SaaS
- Valida redirect_uri contra whitelist ✅
- Valida state mínimo 16 chars ✅
- Registra state server-side com profileId e redirectUri ✅
- State é one-shot (consumeOauthState deleta) ✅
- State expira em 10 min ✅
- Suporta PKCE (code_challenge) ✅

### Troca de código (exchange_code)
- Valida redirect_uri contra whitelist ✅
- Valida state server-side (consumeOauthState) ✅
- Verifica redirect_uri match ✅
- Verifica profileId match ✅
- Troca code por token via ML API ✅
- Valida payload do ML (user_id, access_token, refresh_token, expires_in) ✅
- Chama /users/{user_id} para obter nickname ✅
- Usa tokenData.user_id como seller_id ✅
- Chama upsertConnection com seller_id correto ✅

### PROBLEMA ENCONTRADO:
- Linha 276: Chama `/users/{tokenData.user_id}` em vez de `/users/me`
- Isso é CORRETO porque tokenData.user_id vem direto do ML OAuth response
- O ML retorna user_id no token response, que é o seller_id real
- Não há risco de confusão aqui

## 2. upsertConnection (storage.js:306)

### Lógica:
- Busca conexão existente por seller_id (getConnectionBySellerId)
- Se existe: usa o ID existente (preserva connectionId)
- Se não existe: gera novo UUID
- ON CONFLICT(seller_id) DO UPDATE: atualiza tokens

### SEGURANÇA SaaS:
- Chave de conflito é seller_id ✅
- Nunca mistura tokens entre sellers ✅
- Se EcoFerro (83594950) re-autorizar, atualiza somente a conexão 83594950 ✅
- Se Fantom (75043688) autorizar, cria/atualiza somente a conexão 75043688 ✅
- NÃO usa findFirst sem filtro ✅
- NÃO usa conexão default ✅

## 3. Refresh Token (mercado-livre.js:25)

### Segurança:
- Recebe connectionId como parâmetro ✅
- Busca conexão por ID (getConnectionById) ✅
- Usa refresh_token DAQUELA conexão ✅
- Atualiza SOMENTE aquela conexão (updateConnectionTokens com connectionId) ✅
- Mutex por connectionId (refreshInflight Map) ✅
- Timeout de 30s com AbortController ✅
- NÃO existe updateMany ✅
- NÃO existe refresh global ✅
- NÃO existe singleton de token ✅
- NÃO existe env sobrescrevendo token ✅

## 4. Frontend (MLCallbackPage.tsx + mlOAuth.ts)

### Segurança:
- State gerado com 32 bytes aleatórios (randomString(32)) ✅
- Code verifier gerado com 64 bytes aleatórios ✅
- Armazenado em sessionStorage (não localStorage) ✅
- Validação de state no callback (oauthSession.state !== state) ✅
- Limpa session após uso (clearStoredMLOAuthSession) ✅
- NÃO armazena connectionId no frontend ✅
- NÃO força EcoFerro como default ✅

## 5. LACUNA IDENTIFICADA - Guarda de Segurança

Não existe `assertOAuthTokenBelongsToConnection` no código.
Se por algum motivo o token de uma conta for salvo na conexão errada,
o sistema usaria esse token sem validar.

CORREÇÃO NECESSÁRIA: Implementar guarda no fetchMLLiveChipBucketsDetailed.

## 6. Validação /users/me (PRODUÇÃO REAL)

| Conta | connectionId | seller_id esperado | /users/me id | nickname | MATCH |
|---|---|---|---|---|---|
| ECOFERRO | d6e57eb7-217f-441d-a688-a54149fe65b3 | 75043688 | 75043688 | ECOFERRO | TRUE |
| FANTOM 01 | 3c75e4e0-6e3a-4e36-8810-3b1395f72b04 | 83594950 | 83594950 | FANTOM 01 | TRUE |

### Conclusão:
- Tokens estão CORRETOS
- Cada conexão aponta para o seller_id correto
- Fingerprints são diferentes (d36b3dbffc vs f4b14b9a9a)
- NÃO há cruzamento de tokens
- O nickname "ECOFERRO" pertence ao seller_id 75043688 (confirmado pelo ML)
- O nickname "FANTOM 01" pertence ao seller_id 83594950 (confirmado pelo ML)

## 7. Auditoria Callback OAuth (auth.js)

### Fluxo exchange_code:
1. Valida redirect_uri (whitelist) ✅
2. Valida state (one-shot, TTL 10min, profileId match) ✅
3. Troca code por token via ML API ✅
4. Valida payload ML (user_id, access_token, refresh_token, expires_in) ✅
5. Busca /users/{user_id} para nickname ✅
6. Chama upsertConnection com seller_id = tokenData.user_id ✅

### upsertConnection:
- Chave: ON CONFLICT(seller_id) ✅
- Se seller_id já existe: atualiza tokens daquela conexão ✅
- Se seller_id é novo: cria nova conexão ✅
- NÃO usa findFirst sem filtro ✅
- NÃO usa conexão default ✅
- NÃO sobrescreve token de outra conta ✅

## 8. Auditoria Refresh Token (mercado-livre.js)

### doRefreshToken(connectionId):
- Recebe connectionId como parâmetro ✅
- Busca conexão por getConnectionById(connectionId) ✅
- Usa refresh_token DAQUELA conexão ✅
- Chama updateConnectionTokens(connectionId, ...) ✅
- Mutex por connectionId (refreshInflight Map) ✅
- Timeout 30s com AbortController ✅

### Riscos verificados:
- updateMany inseguro: NÃO EXISTE ✅
- update sem seller_id/connectionId: NÃO EXISTE ✅
- refresh global: NÃO EXISTE ✅
- singleton de token: NÃO EXISTE ✅
- env sobrescrevendo token: NÃO EXISTE ✅

## 9. Auditoria Frontend

### Seletor de conta:
- Frontend envia connectionId como query param `connection_id` ✅
- Cache no frontend é scoped por connectionId (useMercadoLivreData.ts:90) ✅
- Snapshot cache é scoped por (scope, connectionId) (useMLLiveSnapshot.ts:25) ✅
- NÃO força EcoFerro como default — usa `connectionId || "default"` ✅
- Sprint 2.5 fix: não lê cache se connectionId não foi resolvido ainda ✅

### Backend (handler dashboard.js:3095):
- Requer autenticação (requireAuthenticatedProfile) ✅
- Lê connection_id do query param ✅
- Passa connectionId para buildDashboardPayload ✅
- buildDashboardPayload resolve via getConnectionById(requestedConnectionId) ✅
- Se connectionId inválido: retorna payload vazio (não dados de outra conta) ✅

### LACUNA IDENTIFICADA:
- O backend NÃO valida se o connectionId pertence ao tenant/profile autenticado
- Qualquer usuário autenticado pode acessar qualquer connectionId
- Para single-tenant (EcoFerro) isso não é problema
- Para SaaS multi-tenant futuro: PRECISA de validação tenant ↔ connectionId
- RISCO: BAIXO (sistema atual é single-tenant com 1 perfil)
- RECOMENDAÇÃO: Adicionar validação quando implementar multi-tenant real

## 10. Amostra de Pedidos por Conta (Produção Real)

### ECOFERRO (seller_id: 75043688, connectionId: d6e57eb7):
| order_id | shipment_id | status | substatus | logistic_type |
|---|---|---|---|---|
| 2000016322861378 | 47013267521 | pending | buffered | cross_docking |
| 2000016322837048 | 47013526380 | ready_to_ship | invoice_pending | cross_docking |
| 2000016322209568 | 47013224330 | ready_to_ship | invoice_pending | cross_docking |
| 2000016322086414 | 47012879621 | pending | buffered | cross_docking |
| 2000016322034048 | 47012852987 | ready_to_ship | invoice_pending | cross_docking |

### FANTOM (seller_id: 83594950, connectionId: 3c75e4e0):
| order_id | shipment_id | status | substatus | logistic_type |
|---|---|---|---|---|
| 2000016322716998 | 47013188029 | pending | buffered | cross_docking |
| 2000016322382720 | 47013299720 | ready_to_ship | invoice_pending | cross_docking |
| 2000016321965646 | 47012819143 | ready_to_ship | invoice_pending | cross_docking |
| 2000016321854654 | 47012766079 | pending | buffered | cross_docking |
| 2000016321835326 | 47012763251 | ready_to_ship | in_warehouse | fulfillment |

### Conclusão:
- Pedidos são DIFERENTES entre contas (order_ids distintos) ✅
- ECOFERRO: 100% cross_docking ✅
- FANTOM: mix cross_docking + fulfillment ✅
- Tokens estão corretos e retornam dados do seller certo ✅
- NÃO há cruzamento de dados entre contas ✅
