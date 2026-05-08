# Validação IDOR em Produção (TAREFAS 5 e 6)

**Data:** 2026-05-08  
**Status:** APROVADO  
**Ambiente:** Produção (vendas.ecoferro.com.br)

## Conexões Reais em Produção

| Conta | connection_id | seller_id | profile_id (owner) |
|-------|---------------|-----------|-------------------|
| ECOFERRO | d6e57eb7-217f-441d-a688-a54149fe65b3 | 75043688 | admin.ecoferro |
| FANTOM 01 | 3c75e4e0-6e3a-4e36-8810-3b1395f72b04 | 83594950 | admin.ecoferro |

## Testes Executados

| Teste | Ator | Conexão Alvo | Resultado | Esperado | Status |
|-------|------|--------------|-----------|----------|--------|
| A | admin.ecoferro | ECOFERRO | Dados retornados (118 upcoming) | OK | PASS |
| B | admin.ecoferro | FANTOM | Dados retornados (62 upcoming) | OK | PASS |
| C | vendas.ecoferro (operator) | ECOFERRO | 403 "Acesso negado: conexao pertence a outro perfil." | BLOQUEADO | PASS |
| D | vendas.ecoferro (operator) | FANTOM | 403 "Acesso negado: conexao pertence a outro perfil." | BLOQUEADO | PASS |
| E | Sem auth | ECOFERRO | 401 "Sessao invalida." | BLOQUEADO | PASS |
| F | Admin | connection_id fake | 404 "Conexao nao encontrada." | BLOQUEADO | PASS |
| G | Operator sem connection_id | default | "Nenhuma conexao ML vinculada ao seu perfil." | BLOQUEADO | PASS |

## Conclusão

O isolamento multi-tenant está funcionando corretamente em produção. O operator sem conexões vinculadas ao seu perfil é bloqueado com 403 ao tentar acessar qualquer conexão que pertence a outro perfil. Conexões inexistentes retornam 404. Requisições sem autenticação retornam 401.
