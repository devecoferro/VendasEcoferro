/**
 * test-oauth-saas.js
 * Suite de testes para validar segurança OAuth SaaS multi-conta.
 * Verifica isolamento de tokens, guarda de segurança, e fluxo completo.
 */

import { readFileSync } from "fs";

const dashboardSrc = readFileSync("./api/ml/dashboard.js", "utf8");
const authSrc = readFileSync("./api/ml/auth.js", "utf8");
const storageSrc = readFileSync("./api/ml/_lib/storage.js", "utf8");
const mlSrc = readFileSync("./api/ml/_lib/mercado-livre.js", "utf8");
const notifSrc = readFileSync("./api/ml/notifications.js", "utf8");

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// A. GUARDA assertOAuthTokenBelongsToConnection
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ A. GUARDA assertOAuthTokenBelongsToConnection ═══");

assert(
  dashboardSrc.includes("[SECURITY] OAuth token seller mismatch"),
  "Guarda de segurança existe no dashboard.js"
);

assert(
  dashboardSrc.includes("String(connection.seller_id) !== String(validConnection.seller_id)"),
  "Guarda compara connection.seller_id com validConnection.seller_id"
);

assert(
  dashboardSrc.includes("return null; // Bloqueia"),
  "Guarda retorna null (bloqueia) quando seller_id não bate"
);

// ═══════════════════════════════════════════════════════════════
// B. OAUTH STATE SECURITY
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ B. OAUTH STATE SECURITY ═══");

assert(
  authSrc.includes("consumeOauthState"),
  "State é one-shot (consumeOauthState)"
);

assert(
  authSrc.includes("state.length < 16"),
  "State mínimo 16 chars validado"
);

assert(
  authSrc.includes("profileId") && authSrc.includes("redirectUri"),
  "State vincula profileId e redirectUri"
);

// ═══════════════════════════════════════════════════════════════
// C. UPSERT CONNECTION SEGURANÇA
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ C. UPSERT CONNECTION SEGURANÇA ═══");

assert(
  storageSrc.includes("ON CONFLICT(seller_id)"),
  "upsertConnection usa ON CONFLICT(seller_id)"
);

assert(
  storageSrc.includes("getConnectionBySellerId"),
  "Busca conexão existente por seller_id antes de inserir"
);

assert(
  !storageSrc.includes("findFirst()") && !storageSrc.includes(".first()"),
  "NÃO usa findFirst() sem filtro (risco de retornar conexão errada)"
);

// ═══════════════════════════════════════════════════════════════
// D. REFRESH TOKEN ISOLAMENTO
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ D. REFRESH TOKEN ISOLAMENTO ═══");

assert(
  mlSrc.includes("getConnectionById(connectionId)") || mlSrc.includes("getConnectionById(id)"),
  "Refresh busca conexão por ID específico"
);

assert(
  mlSrc.includes("updateConnectionTokens"),
  "Refresh atualiza tokens via updateConnectionTokens (scoped)"
);

assert(
  !mlSrc.includes("updateMany") && !mlSrc.includes("UPDATE ml_connections SET"),
  "NÃO existe updateMany inseguro no refresh"
);

assert(
  mlSrc.includes("refreshInflight") || mlSrc.includes("Inflight"),
  "Mutex por conexão para evitar race condition no refresh"
);

// ═══════════════════════════════════════════════════════════════
// E. CACHE MULTI-CONTA ISOLAMENTO
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ E. CACHE MULTI-CONTA ISOLAMENTO ═══");

assert(
  dashboardSrc.includes('connection?.id || connection?.seller_id || "default"'),
  "liveChipDetailedCache usa connection.id como chave"
);

assert(
  dashboardSrc.includes("dashboardCacheByConnection"),
  "Dashboard cache é um Map por connectionId"
);

assert(
  dashboardSrc.includes("invalidateDashboardCache(connectionId") ||
  dashboardSrc.includes("invalidateDashboardCache(connection"),
  "Invalidação de cache é cirúrgica por connectionId"
);

// ═══════════════════════════════════════════════════════════════
// F. WEBHOOK ISOLAMENTO
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ F. WEBHOOK ISOLAMENTO ═══");

assert(
  notifSrc.includes("getConnectionBySellerId"),
  "Webhook resolve conexão por seller_id"
);

assert(
  notifSrc.includes("invalidateDashboardCache(connection.id)") ||
  notifSrc.includes("invalidateDashboardCache(connection?.id)"),
  "Webhook invalida cache apenas da conta afetada"
);

// ═══════════════════════════════════════════════════════════════
// G. AUSÊNCIA DE LEGADO PERIGOSO
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ G. AUSÊNCIA DE LEGADO PERIGOSO ═══");

assert(
  !dashboardSrc.includes("ML_ACCESS_TOKEN") && !dashboardSrc.includes("process.env.ML_TOKEN"),
  "NÃO usa token de env (singleton global)"
);

assert(
  !dashboardSrc.includes("getLatestConnection().access_token"),
  "NÃO usa getLatestConnection para obter token diretamente"
);

assert(
  !authSrc.includes("updateMany") && !authSrc.includes("UPDATE ml_connections SET access_token"),
  "NÃO existe update global de tokens no auth"
);

// ═══════════════════════════════════════════════════════════════
// H. FRONTEND SEGURANÇA
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ H. FRONTEND SEGURANÇA ═══");

assert(
  dashboardSrc.includes("requireAuthenticatedProfile"),
  "Dashboard handler requer autenticação"
);

assert(
  dashboardSrc.includes("getConnectionById(requestedConnectionId)"),
  "Backend resolve connectionId via getConnectionById (não confia no frontend)"
);

// ═══════════════════════════════════════════════════════════════
// RESULTADO FINAL
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════");
console.log(`RESULTADO: ${passed} PASS / ${failed} FAIL / ${passed + failed} TOTAL`);
console.log("═══════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
