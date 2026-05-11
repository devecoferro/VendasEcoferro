# Release Notes — VendasEcoferro v3.1

**Branch:** `feat/chips-sla-classifier`
**Commits:** `169f592` → `0fcb5a9`
**Data:** 2026-05-11
**Status:** Pronto para merge em `main` e deploy em produção

---

## Resumo Executivo

Esta release entrega três grupos de melhorias: (1) o classificador SLA-aware dos chips operacionais, (2) a sincronização de TTL entre o grid de pedidos e os chips, e (3) a infraestrutura de multi-tenant SaaS com branding dinâmico por perfil. Adicionalmente, corrige dois problemas de segurança no staging (CSP e CSRF) e um bug de autenticação no novo endpoint de configurações.

---

## 1. Classificador SLA-aware dos Chips (Tarefa 1-9)

**Problema resolvido:** O classificador anterior usava apenas o `substatus` do envio para determinar se um pedido era "Envios de hoje" ou "Próximos dias". Para substatuses desconhecidos ou ausentes, o pedido era descartado. O novo classificador usa o `sla_snapshot.expected_date` (já salvo pelo sync) como fonte primária de classificação temporal.

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `api/_lib/app-config.js` | Adiciona `ML_USE_SHIPMENT_SLA_FOR_PROMISES` e `ML_SLA_SHADOW_COMPARE` |
| `api/ml/dashboard.js` | `fetchShipmentSla()`, `shipmentSlaCache`, `invalidateShipmentSlaCache()`, classificação SLA-aware com shadow mode, observabilidade no payload |
| `api/ml/notifications.js` | Invalidação cirúrgica do cache SLA por `shipment_id` no webhook |
| `test-chips-sla-classifier.js` | 53 testes novos cobrindo o classificador SLA-aware |
| `test-chips-oauth.js` | Atualizado para aceitar novo import com `invalidateShipmentSlaCache` |

### Feature Flags

```
ML_USE_SHIPMENT_SLA_FOR_PROMISES=false  # padrão: desativado (backward compat)
ML_SLA_SHADOW_COMPARE=false             # padrão: desativado
```

Para ativar o shadow mode (comparação silenciosa, sem alterar comportamento):
```
ML_SLA_SHADOW_COMPARE=true
```

Para ativar o classificador SLA como fonte primária:
```
ML_USE_SHIPMENT_SLA_FOR_PROMISES=true
```

### Resultado dos Testes

```
test-chips-oauth.js:         17/17 passaram, 0 falharam
test-chips-sla-classifier.js: 53/53 passaram, 0 falharam
```

---

## 2. Sincronização de TTL do Cache (Tarefa 2)

**Problema resolvido:** O cache do grid de pedidos tinha TTL de 5 minutos, enquanto os chips tinham TTL de 50 segundos. Isso causava divergência visual: os chips atualizavam mas o grid mostrava dados antigos.

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `api/ml/orders.js` | `ORDERS_CACHE_TTL_MS`: 5 min → 60 s |
| `src/hooks/useMercadoLivreData.ts` | `DATA_CACHE_TTL_MS`: 5 min → 60 s |

### Comportamento após a mudança

O grid e os chips agora expiram no mesmo intervalo (60 s). A invalidação via webhook continua funcionando para ambos (o `invalidateOrdersCache()` já era chamado no webhook de `shipments`).

---

## 3. Multi-tenant SaaS Branding (Tarefa 4)

**Problema resolvido:** O nome da empresa e o logo estavam hardcoded no `AppSidebar.tsx` e `LoginPage.tsx`. Em um modelo SaaS, cada cliente (Ecoferro, Fantom, futuros clientes) precisa configurar seu próprio branding sem deploy.

### Arquivos criados/modificados

| Arquivo | Descrição |
|---|---|
| `api/_lib/migrations/20260511_add_tenant_settings.sql` | Cria tabela `tenant_settings` (auto-aplicada no boot) |
| `api/tenant-settings.js` | Handler `GET/POST /api/tenant-settings` |
| `server/index.js` | Registra rota `/api/tenant-settings` |
| `src/services/tenantSettingsService.ts` | Cliente da API com cache em memória (5 min) |
| `src/hooks/useTenantSettings.ts` | Hook React com fallback para defaults |
| `src/components/AppSidebar.tsx` | Nome e logo dinâmicos via `useTenantSettings` |
| `src/pages/TenantSettingsPage.tsx` | Página de configuração (admin only) |
| `src/App.tsx` | Rota `/admin/tenant-settings` |

### Esquema da Tabela

```sql
CREATE TABLE IF NOT EXISTS tenant_settings (
  profile_id   INTEGER PRIMARY KEY REFERENCES app_user_profiles(id) ON DELETE CASCADE,
  company_name TEXT    NOT NULL DEFAULT '',
  logo_url     TEXT    NOT NULL DEFAULT '',
  primary_color TEXT   NOT NULL DEFAULT '#16a34a',
  label_footer TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
```

### API

```
GET  /api/tenant-settings          → retorna configurações do perfil autenticado
POST /api/tenant-settings          → salva configurações (admin only)

Corpo do POST:
{
  "company_name": "EcoFerro Comercio de Ferragens",
  "logo_url": "/menu-ecoferro-logo-96.png",
  "primary_color": "#16a34a",
  "label_footer": "EcoFerro Comercio de Ferragens Ltda - CNPJ 00.000.000/0001-00"
}
```

### Segurança

- `GET`: qualquer usuário autenticado (para exibir o branding no sidebar)
- `POST`: somente `role === "admin"`
- Sem autenticação: retorna `401`

---

## 4. Correções de Staging (CSP + CSRF)

### Fix 1 — `upgrade-insecure-requests` condicional

**Problema:** O header CSP `upgrade-insecure-requests` forçava o browser a converter HTTP → HTTPS. No staging (sem SSL válido), os assets JS/CSS falhavam com `ERR_CERT_AUTHORITY_INVALID`.

**Correção:** O header só é incluído quando `APP_BASE_URL` começa com `https://`.

```js
// server/index.js linha ~300
...(APP_BASE_URL_SEC.startsWith("https://") ? ["upgrade-insecure-requests"] : [])
```

### Fix 2 — CSRF aceita variante `https://` do domínio HTTP

**Problema:** O Chrome envia `Origin: https://` mesmo em páginas `http://`. O CSRF check bloqueava com `origin_not_allowed`.

**Correção:** A whitelist inclui automaticamente a variante `https://` do `APP_BASE_URL`.

### Fix 3 — CSRF fallback para `Host` header

**Problema:** O Chrome no Windows não envia `Origin` nem `Referer` em POSTs para `http://`. O servidor bloqueava o login.

**Correção:** Quando ambos estão ausentes, o `Host` header (não forjável cross-origin) é usado como candidato.

---

## 5. Fix de Segurança — Autenticação no tenant-settings

**Problema:** O handler chamava `getAuthenticatedProfile(req)` e comparava o retorno com `null`. Como a função retorna sempre um objeto `{ authUser, profile }` (nunca `null`), a verificação falhava silenciosamente e o endpoint ficava acessível sem autenticação.

**Correção:** Verificação correta: `const { authUser, profile } = await getAuthenticatedProfile(req); if (!authUser || !profile || !profile.active)`.

---

## 6. Testes de Validação em Staging

| Teste | Resultado |
|---|---|
| `GET /api/health` | `{"ok":true}` ✅ |
| `GET /api/tenant-settings` sem auth | `401` ✅ |
| `GET /api/tenant-settings` com auth | `200` com defaults ✅ |
| `POST /api/tenant-settings` com admin | `200`, branding salvo ✅ |
| Login no browser (Chrome Windows) | Funciona ✅ |
| Dashboard ML carrega após login | Funciona ✅ |
| `test-chips-oauth.js` | 17/17 ✅ |
| `test-chips-sla-classifier.js` | 53/53 ✅ |

---

## 7. O que NÃO foi modificado

| Componente | Motivo |
|---|---|
| Lógica de deduplicação por `pack_id` | Já estava correta e testada |
| Webhooks ML (`orders_v2`, `shipments`, `invoices`, `post_purchase`) | Já implementados e funcionando |
| Filtros de substatus (`TODAY_SUBSTATUSES`, `SHIPPED_UPCOMING_SUBSTATUSES`) | Já calibrados conforme engenharia reversa |
| Freshness/stale filters (14d/30d/45d) | Corretos para o escopo operacional |
| NF-e e etiquetas | Fora do escopo desta release |
| Banco de dados de produção | Não tocado; migration aplicada apenas no staging |

---

## 8. Próximos Passos Recomendados

1. **Merge para `main`:** Criar PR do branch `feat/chips-sla-classifier` → `main`
2. **Deploy em produção:** Coolify detecta o push e faz rebuild automático
3. **Ativar shadow mode:** Setar `ML_SLA_SHADOW_COMPARE=true` por 7 dias e monitorar `sla_classifier_observability` no payload do dashboard
4. **Ativar classificador SLA:** Após validação do shadow mode, setar `ML_USE_SHIPMENT_SLA_FOR_PROMISES=true`
5. **Configurar branding:** Acessar `/admin/tenant-settings` e configurar nome, logo e cor para cada tenant
6. **Proxy de imagens:** Implementar `/api/ml/image-proxy` para resolver CORS das imagens do ML CDN nas etiquetas

---

## Commits desta Release

```
0fcb5a9  fix(security): corrige autenticação no tenant-settings handler
9f7d68d  feat: multi-tenant SaaS branding + cache TTL sync + tenant-settings API
51033b9  fix(csrf): fallback para Host header quando Origin/Referer ausentes em HTTP
5740db4  fix: CSRF whitelist aceita variante https:// do APP_BASE_URL HTTP
21fb1fc  fix: CSP upgrade-insecure-requests só em produção HTTPS
169f592  feat: classificador SLA-aware dos chips (Tarefas 1-9)
```
