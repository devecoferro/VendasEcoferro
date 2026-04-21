# 🌐 API Endpoints

Catálogo completo dos endpoints HTTP expostos pelo backend.

Todos os endpoints (exceto `/api/auth` e `/api/ml/auth`) requerem **sessão autenticada** (cookie `ecoferro_session`). Endpoints marcados com 🔒 requerem role `admin`.

---

## Autenticação

| Method | Path | Descrição |
|--------|------|-----------|
| POST | `/api/auth` | Login (username + password) |
| DELETE | `/api/auth` | Logout |
| GET | `/api/auth` | Retorna usuário logado |

### Request login

```http
POST /api/auth
Content-Type: application/json

{
  "username": "admin.ecoferro",
  "password": "****"
}
```

### Response

```json
{ "success": true, "profile": { "id": "...", "username": "...", "role": "admin" } }
```

---

## Usuários 🔒

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/users` 🔒 | Lista usuários |
| POST | `/api/users` 🔒 | Cria usuário |
| PATCH | `/api/users?id=X` 🔒 | Atualiza (role, senha) |
| DELETE | `/api/users?id=X` 🔒 | Desativa usuário |

---

## Mercado Livre

### OAuth / Conexão

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/auth` | Inicia fluxo OAuth |
| POST | `/api/ml/auth` | Callback OAuth (trocar code → token) |

### Pedidos (API pública)

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/orders` | Lista pedidos do SQLite |
| GET | `/api/ml/orders?scope=operational&limit=5000` | Escopo operacional (últimos dias ativos) |
| GET | `/api/ml/dashboard` | Dashboard agregado (internal + mirror) |
| GET | `/api/ml/packs` | Pedidos agrupados por pack |
| GET | `/api/ml/stores` | Depósitos/lojas configurados |

### Sync

| Method | Path | Descrição |
|--------|------|-----------|
| POST | `/api/ml/sync` | Sincroniza pedidos do ML (força) |
| GET | `/api/ml/sync-events` | SSE — eventos de sync em tempo real |
| POST | `/api/ml/sync-to-website` 🔒 | Sync de leads/customers para site externo |
| POST | `/api/ml/sync-reviews` 🔒 | Sync de avaliações |
| POST | `/api/ml/sync-leads` 🔒 | Sync de leads |
| POST | `/api/ml/sync-customers` 🔒 | Sync de clientes |

### Etiquetas e NF-e

| Method | Path | Descrição |
|--------|------|-----------|
| POST | `/api/ml/labels/mark-printed` | Marca pedido como impresso |
| POST | `/api/ml/labels/mark-unprinted` | Desmarca impressão |
| GET | `/api/ml/order-documents?packId=X` | Docs do pedido (etiqueta ML + DANFe) |
| GET | `/api/ml/order-documents/file?url=X` | Baixa arquivo de documento |

### Diagnóstico e private seller center

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/diagnostics` 🔒 | Status da integração ML |
| GET | `/api/ml/private-seller-center-snapshots` 🔒 | Lista snapshots salvos |
| GET | `/api/ml/private-seller-center-comparison` 🔒 | Comparativo nosso app vs ML |

### Live snapshot (V 3.0) ⭐

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/live-snapshot` 🔒 | Snapshot live do ML (cache 5min) |
| GET | `/api/ml/live-snapshot?run=1` 🔒 | Força scrape fresh (~90s) |

**Response completo**: ver [ML-LIVE-SNAPSHOT.md](./ML-LIVE-SNAPSHOT.md#schema-do-snapshot)

### Reclamações e devoluções

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/claims` | Lista reclamações abertas |
| GET | `/api/ml/returns` | Lista devoluções |

### Estoque

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/stock` | Lista produtos do estoque |
| POST | `/api/ml/stock` 🔒 | Cria produto |
| PATCH | `/api/ml/stock?id=X` 🔒 | Atualiza produto |
| DELETE | `/api/ml/stock?id=X` 🔒 | Remove produto |
| POST | `/api/ml/fix-brands` 🔒 | Corrige marcas em lote |

### Picking / Conferência

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/picking-list?date=YYYY-MM-DD` | Lista de separação por SKU |
| GET | `/api/ml/conferencia?packId=X` | Dados pra conferência via QR |

### Notificações

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/notifications` | Webhook do ML (público com token) |

### Utilidades

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/image-proxy?url=X` | Proxy para imagens do ML (resolve CORS) |
| GET | `/api/ml/leads` 🔒 | Lista leads do ML |

### Admin

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/ml/admin/audit-brands` 🔒 | Auditoria de marcas não identificadas |
| GET | `/api/ml/admin/classify-debug` 🔒 | Debug da classificação de pedidos |
| GET | `/api/ml/admin/live-cards-debug` 🔒 | Debug do scraper Playwright (diagnóstico) |
| ALL | `/api/ml/admin/upload-scraper-state` 🔒 | Upload do storage state do Playwright |
| ALL | `/api/ml/admin/install-chromium` 🔒 | Instala Chromium em volume persistente |

---

## Report Debug (V 3.0) ⭐

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/debug-reports` | Lista reports (admin vê todos, user vê só seus) |
| GET | `/api/debug-reports?id=X` | Retorna 1 report específico |
| GET | `/api/debug-reports?summary=1` 🔒 | Estatísticas agregadas |
| POST | `/api/debug-reports` | Cria novo report |
| PATCH | `/api/debug-reports?id=X` 🔒 | Atualiza status/notas admin |
| DELETE | `/api/debug-reports?id=X` 🔒 | Remove report |
| GET | `/api/debug-reports/screenshot?file=X` | Baixa imagem do report |

### Request criar

```http
POST /api/debug-reports
Content-Type: application/json

{
  "type": "bug",               // bug | suggestion | question
  "title": "Título curto",
  "description": "Descrição detalhada",
  "screen": "EcoFerro (Mercado Livre)",
  "priority": "medium",        // low | medium | high
  "screenshots": [
    "data:image/png;base64,iVBORw0KGgo..."   // data URL, max 2MB
  ]
}
```

### Response

```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "user_id": "...",
    "username": "admin.ecoferro",
    "type": "bug",
    "title": "...",
    "description": "...",
    "screen": "EcoFerro (Mercado Livre)",
    "priority": "medium",
    "screenshots": ["uuid-xxx.png"],
    "status": "open",
    "admin_notes": null,
    "created_at": "2026-04-21T00:40:37.861Z",
    "updated_at": "2026-04-21T00:40:37.861Z"
  }
}
```

---

## Outros

### Review (PDFs)

| Method | Path | Descrição |
|--------|------|-----------|
| POST | `/api/review/upload` | Upload de PDF pra OCR |
| GET | `/api/review/list` | Lista PDFs processados |

### Health

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Health check pro Docker |

---

## Rate limits

- **`apiLimiter`**: 100 req/min por IP (default pra todos `/api/*`)
- **`authLimiter`**: 10 req/min por IP (pra `/api/auth` e `/api/ml/auth`)
- **`syncLimiter`**: 5 req/min por IP (pra endpoints de sync pesados)

---

## Códigos de erro comuns

| Code | Significado |
|------|-------------|
| 200 | OK |
| 201 | Created (POST de novo recurso) |
| 400 | Bad request (payload inválido) |
| 401 | Unauthorized (sessão inválida/expirada) |
| 403 | Forbidden (usuário sem permissão — ex: operador tentando acessar admin) |
| 404 | Not found |
| 409 | Conflict (ex: scraper não configurado) |
| 429 | Too many requests (rate limit) |
| 500 | Internal server error |
| 502 | Bad gateway (ex: ML offline, scraper timeout) |

---

_Última atualização: 2026-04-20 (V 3.0)_
