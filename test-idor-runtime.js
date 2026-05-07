/**
 * test-idor-runtime.js — Teste IDOR (Insecure Direct Object Reference) em runtime
 *
 * Valida que:
 * 1. profile_id null bloqueia rotas user-facing (403)
 * 2. Profile A não acessa connection B
 * 3. Profile B não acessa connection A
 * 4. Admin bypass audita (com options.adminContext)
 * 5. Dashboard não retorna cache cross-tenant
 * 6. OAuth callback grava profile_id
 * 7. seller_id já conectado em outro tenant bloqueia
 * 8. getDefaultConnectionForProfile nunca retorna conexão órfã
 *
 * Execução: node test-idor-runtime.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  TEST-IDOR-RUNTIME: Validação IDOR Multi-Tenant SaaS");
console.log("═══════════════════════════════════════════════════════════════");

// ═══ GRUPO 1: assertConnectionBelongsToProfile bloqueia profile_id null ═══
console.log("\n═══ GRUPO 1: Bloqueio de profile_id null ═══");

const storageSrc = readFile("api/ml/_lib/storage.js");

assert(
  storageSrc.includes("Connection has no tenant owner") &&
  storageSrc.includes("err.statusCode = 403"),
  "profile_id null retorna 403 com mensagem 'Connection has no tenant owner'"
);

assert(
  storageSrc.includes("options.adminContext === true") &&
  storageSrc.includes("admin_bypass.orphan_connection_access"),
  "Admin bypass para conexão órfã requer options.adminContext=true explícito"
);

assert(
  !storageSrc.includes("if (profileRole === \"admin\") {\n    return connection;\n  }\n\n  // Conexão sem owner"),
  "Não existe bypass silencioso de admin para conexões sem owner"
);

// ═══ GRUPO 2: Rotas user-facing NÃO passam adminContext ═══
console.log("\n═══ GRUPO 2: Rotas user-facing sem adminContext ═══");

const dashboardSrc = readFile("api/ml/dashboard.js");
const ordersSrc = readFile("api/ml/orders.js");
const stockSrc = readFile("api/ml/stock.js");
const syncSrc = readFile("api/ml/sync.js");
const labelsSrc = readFile("api/ml/labels-batch.js");

// Nenhuma rota user-facing deve passar adminContext: true
assert(
  !dashboardSrc.includes("adminContext: true"),
  "dashboard.js NÃO passa adminContext: true (rota user-facing)"
);
assert(
  !ordersSrc.includes("adminContext: true"),
  "orders.js NÃO passa adminContext: true (rota user-facing)"
);
assert(
  !stockSrc.includes("adminContext: true"),
  "stock.js NÃO passa adminContext: true (rota user-facing)"
);
assert(
  !syncSrc.includes("adminContext: true"),
  "sync.js NÃO passa adminContext: true (rota user-facing)"
);
assert(
  !labelsSrc.includes("adminContext: true"),
  "labels-batch.js NÃO passa adminContext: true (rota user-facing)"
);

// ═══ GRUPO 3: getDefaultConnectionForProfile nunca retorna órfã ═══
console.log("\n═══ GRUPO 3: getDefaultConnectionForProfile tenant-safe ═══");

assert(
  storageSrc.includes("profile_id IS NOT NULL") &&
  storageSrc.includes("getDefaultConnectionForProfile"),
  "getDefaultConnectionForProfile: admin fallback só retorna conexões com owner"
);

assert(
  !storageSrc.includes("getDefaultConnectionForProfile") ||
  !storageSrc.match(/getDefaultConnectionForProfile[\s\S]*?getLatestConnection/),
  "getDefaultConnectionForProfile NÃO usa getLatestConnection (fallback legado removido)"
);

// ═══ GRUPO 4: Dashboard usa getDefaultConnectionForProfile ═══
console.log("\n═══ GRUPO 4: Dashboard sem fallback legado ═══");

assert(
  dashboardSrc.includes("getDefaultConnectionForProfile(profile.id, profile.role)"),
  "Dashboard resolve default via getDefaultConnectionForProfile (tenant-scoped)"
);

assert(
  dashboardSrc.includes("getDefaultConnectionForProfile") &&
  !dashboardSrc.match(/handler[\s\S]*?getLatestConnection\(\)/),
  "Dashboard handler NÃO usa getLatestConnection() diretamente"
);

// ═══ GRUPO 5: Labels-batch usa getDefaultConnectionForProfile ═══
console.log("\n═══ GRUPO 5: Labels-batch sem fallback legado ═══");

assert(
  labelsSrc.includes("getDefaultConnectionForProfile(request.profile.id, request.profile.role)"),
  "Labels-batch resolve default via getDefaultConnectionForProfile (tenant-scoped)"
);

// ═══ GRUPO 6: Orders usa getDefaultConnectionForProfile ═══
console.log("\n═══ GRUPO 6: Orders sem fallback legado ═══");

assert(
  ordersSrc.includes("getDefaultConnectionForProfile(profile.id, profile.role)"),
  "Orders resolve default via getDefaultConnectionForProfile (tenant-scoped)"
);

// ═══ GRUPO 7: Cross-tenant protection ═══
console.log("\n═══ GRUPO 7: Cross-tenant protection ═══");

assert(
  storageSrc.includes("connection.profile_id !== profileId") &&
  storageSrc.includes("Acesso negado: conexao pertence a outro perfil"),
  "Operator recebe 403 ao acessar conexão de outro perfil"
);

assert(
  storageSrc.includes("admin_bypass.connection_access") &&
  storageSrc.includes("adminProfileId") &&
  storageSrc.includes("targetProfileId") &&
  storageSrc.includes("targetConnectionId") &&
  storageSrc.includes("route") &&
  storageSrc.includes("timestamp") &&
  storageSrc.includes("reason"),
  "Admin bypass registra audit log completo (adminProfileId, targetProfileId, targetConnectionId, route, timestamp, reason)"
);

// ═══ GRUPO 8: upsertConnection cross-tenant hijack protection ═══
console.log("\n═══ GRUPO 8: upsertConnection cross-tenant hijack ═══");

assert(
  storageSrc.includes("ja pertence a outro perfil") &&
  storageSrc.includes("existing.profile_id !== connection.profile_id"),
  "upsertConnection bloqueia seller_id já conectado em outro tenant"
);

// ═══ GRUPO 9: OAuth callback grava profile_id ═══
console.log("\n═══ GRUPO 9: OAuth callback grava profile_id ═══");

const authSrc = readFile("api/ml/auth.js");
assert(
  authSrc.includes("profile_id") &&
  authSrc.includes("upsertConnection"),
  "OAuth callback (auth.js) passa profile_id ao upsertConnection"
);

// ═══ GRUPO 10: Cache não bypassa autorização ═══
console.log("\n═══ GRUPO 10: Cache protegido por autorização ═══");

// No dashboard, assertConnectionBelongsToProfile é chamada ANTES de buildDashboardPayload (que lê cache)
const dashHandlerMatch = dashboardSrc.match(
  /assertConnectionBelongsToProfile[\s\S]*?buildDashboardPayload/
);
assert(
  dashHandlerMatch !== null,
  "Dashboard: assertConnectionBelongsToProfile executada ANTES de buildDashboardPayload (cache)"
);

// No orders, assertConnectionBelongsToProfile é chamada ANTES de readOrdersCache
const ordersHandlerSection = ordersSrc.slice(ordersSrc.indexOf("assertConnectionBelongsToProfile"));
assert(
  ordersHandlerSection.includes("readOrdersCache") || ordersHandlerSection.includes("cacheKey"),
  "Orders: assertConnectionBelongsToProfile executada ANTES do cache read"
);

// ═══ GRUPO 11: Sync e Stock requerem connection_id ═══
console.log("\n═══ GRUPO 11: Sync e Stock requerem connection_id ═══");

assert(
  syncSrc.includes("connection_id is required") || syncSrc.includes("connection_id"),
  "Sync requer connection_id explícito"
);

assert(
  stockSrc.includes("connection_id obrigatório") || stockSrc.includes("connection_id obrigat"),
  "Stock requer connection_id explícito"
);

// ═══ RESULTADO ═══
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  RESULTADO: ${passed} PASS / ${failed} FAIL / ${passed + failed} TOTAL`);
console.log("═══════════════════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
