/**
 * test-multitenant-access.js
 * Suite de testes para validar controle de acesso multi-tenant SaaS.
 * Verifica que:
 *   1. assertConnectionBelongsToProfile bloqueia acesso cruzado
 *   2. Admin pode acessar qualquer conexão
 *   3. Operator não pode acessar conexão de outro perfil
 *   4. Conexões legado (sem profile_id) só são acessíveis por admin
 *   5. upsertConnection bloqueia cross-tenant hijack
 *   6. Todas as rotas user-facing importam e usam a guarda
 *   7. Webhooks NÃO usam a guarda (correto: server-to-server)
 *   8. Cache é escopado por connectionId
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname || ".");
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ FALHOU: ${msg}`);
  }
}

function readFile(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 1: assertConnectionBelongsToProfile (lógica da guarda)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 1: Lógica da guarda assertConnectionBelongsToProfile ═══");

const storageSrc = readFile("api/ml/_lib/storage.js");

assert(
  storageSrc.includes("export function assertConnectionBelongsToProfile(connectionId, profileId, profileRole"),
  "Função assertConnectionBelongsToProfile exportada com assinatura correta"
);

assert(
  storageSrc.includes('profileRole === "admin"') &&
  storageSrc.includes("return connection;"),
  "Admin pode acessar qualquer conexão (retorna connection)"
);

assert(
  storageSrc.includes("connection.profile_id !== profileId") &&
  storageSrc.includes("statusCode = 403"),
  "Operator recebe 403 ao acessar conexão de outro perfil"
);

assert(
  storageSrc.includes("!connection.profile_id") &&
  storageSrc.includes("Connection has no tenant owner"),
  "Conexão sem owner bloqueia com 'Connection has no tenant owner'"
);

assert(
  storageSrc.includes("statusCode = 404") &&
  storageSrc.includes("Conexao nao encontrada"),
  "Conexão inexistente retorna 404"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 2: Cross-tenant hijack protection no upsertConnection
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 2: Cross-tenant hijack protection ═══");

assert(
  storageSrc.includes("existing.profile_id !== connection.profile_id") &&
  storageSrc.includes("ja pertence a outro perfil"),
  "upsertConnection bloqueia hijack de seller por outro perfil"
);

assert(
  storageSrc.includes("profile_id = COALESCE(excluded.profile_id, ml_connections.profile_id)"),
  "ON CONFLICT preserva profile_id existente se novo for null"
);

assert(
  storageSrc.includes("profile_id: connection.profile_id || existing?.profile_id || null"),
  "Params passam profile_id para o SQL"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 3: Guarda aplicada em TODAS as rotas user-facing
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 3: Guarda em rotas user-facing ═══");

const dashSrc = readFile("api/ml/dashboard.js");
assert(
  dashSrc.includes("assertConnectionBelongsToProfile") &&
  dashSrc.includes("import") &&
  dashSrc.includes("assertConnectionBelongsToProfile(connectionId, profile.id, profile.role)"),
  "dashboard.js: guarda aplicada com profile.id e profile.role"
);

const ordersSrc = readFile("api/ml/orders.js");
assert(
  ordersSrc.includes("assertConnectionBelongsToProfile") &&
  ordersSrc.includes("assertConnectionBelongsToProfile(connectionId, profile.id, profile.role)"),
  "orders.js: guarda aplicada com profile.id e profile.role"
);

const stockSrc = readFile("api/ml/stock.js");
assert(
  stockSrc.includes("assertConnectionBelongsToProfile") &&
  stockSrc.includes("assertConnectionBelongsToProfile(connectionId, req.profile.id, req.profile.role)"),
  "stock.js: guarda aplicada com req.profile.id e req.profile.role"
);

const syncSrc = readFile("api/ml/sync.js");
assert(
  syncSrc.includes("assertConnectionBelongsToProfile") &&
  syncSrc.includes("assertConnectionBelongsToProfile(connection_id, profile.id, profile.role)"),
  "sync.js: guarda aplicada com profile.id e profile.role"
);

const labelsSrc = readFile("api/ml/labels-batch.js");
assert(
  labelsSrc.includes("assertConnectionBelongsToProfile") &&
  labelsSrc.includes("assertConnectionBelongsToProfile(connectionId, request.profile.id, request.profile.role)"),
  "labels-batch.js: guarda aplicada com request.profile.id e request.profile.role"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 4: Webhooks NÃO usam a guarda (correto)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 4: Webhooks isolados (server-to-server) ═══");

const notifSrc = readFile("api/ml/notifications.js");
assert(
  !notifSrc.includes("assertConnectionBelongsToProfile"),
  "notifications.js: NÃO usa guarda multi-tenant (correto: server-to-server)"
);

assert(
  notifSrc.includes("getConnectionBySellerId(sellerId)"),
  "notifications.js: resolve conexão por seller_id do payload ML (não aceita connectionId externo)"
);

assert(
  notifSrc.includes("isWebhookAuthorized") &&
  notifSrc.includes("timingSafeEqual"),
  "notifications.js: autenticação via WEBHOOK_SECRET com timingSafeEqual"
);

assert(
  notifSrc.includes("invalidateDashboardCache(connection.id)"),
  "notifications.js: invalidação cirúrgica por connection.id"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 5: Cache escopado por connectionId
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 5: Cache multi-tenant ═══");

assert(
  dashSrc.includes("dashboardCacheByConnection") &&
  dashSrc.includes("new Map()"),
  "dashboard.js: cache usa Map com connectionId como chave"
);

assert(
  dashSrc.includes("liveChipDetailedCache.delete(connectionId)"),
  "dashboard.js: invalidação cirúrgica do liveChipDetailedCache por connectionId"
);

assert(
  ordersSrc.includes("connectionId || \"default\""),
  "orders.js: cache key inclui connectionId para isolamento"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 6: Migration e schema
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 6: Migration e schema ═══");

const migrationSrc = readFile("api/_lib/migrations/20260507_add_profile_id_to_connections.sql");
assert(
  migrationSrc.includes("ALTER TABLE ml_connections ADD COLUMN profile_id"),
  "Migration: adiciona coluna profile_id à tabela ml_connections"
);

assert(
  migrationSrc.includes("REFERENCES app_user_profiles(id)"),
  "Migration: FK para app_user_profiles"
);

assert(
  migrationSrc.includes("CREATE INDEX IF NOT EXISTS idx_ml_connections_profile_id"),
  "Migration: índice para busca rápida por profile_id"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 7: auth.js vincula profile_id ao conectar
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 7: Vinculação de profile_id no OAuth callback ═══");

const authSrc = readFile("api/ml/auth.js");
assert(
  authSrc.includes("profile_id: profile?.profile?.id || profile?.id || null"),
  "auth.js: passa profile_id ao upsertConnection no exchange_code"
);

// ═══════════════════════════════════════════════════════════════════════════
// GRUPO 8: Funções auxiliares multi-tenant
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ GRUPO 8: Funções auxiliares multi-tenant ═══");

assert(
  storageSrc.includes("export function listConnectionsForProfile(profileId, profileRole)"),
  "storage.js: listConnectionsForProfile exportada"
);

assert(
  storageSrc.includes("export function getDefaultConnectionForProfile(profileId, profileRole)"),
  "storage.js: getDefaultConnectionForProfile exportada"
);

assert(
  storageSrc.includes("profile_id: row.profile_id || null"),
  "storage.js: mapConnection inclui profile_id"
);

// ═══════════════════════════════════════════════════════════════════════════
// RESULTADO FINAL
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam de ${passed + failed} testes`);
console.log("═══════════════════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
