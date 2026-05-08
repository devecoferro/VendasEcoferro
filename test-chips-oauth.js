/**
 * Teste de validação: OAuth como única fonte de verdade dos chips.
 *
 * Verifica:
 * 1. dashboard.js não importa mais fetchMLChipsByStoreDirect
 * 2. notifications.js invalida cache imediatamente
 * 3. liveChipDetailedCache usa connection.id como chave
 * 4. Regra ready_to_print Full está preservada
 * 5. ml_ui_chip_counts é alimentado por mlLiveChipCounts (OAuth)
 *
 * Executar: node test-chips-oauth.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dashboardPath = resolve(__dirname, "api/ml/dashboard.js");
const notificationsPath = resolve(__dirname, "api/ml/notifications.js");

const dashboardCode = readFileSync(dashboardPath, "utf8");
const notificationsCode = readFileSync(notificationsPath, "utf8");

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ FALHOU: ${name}`);
    failed++;
  }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("TESTE: OAuth como única fonte de verdade dos chips");
console.log("═══════════════════════════════════════════════════════════");
console.log();

// ── 1. HTTP Fetcher desativado ──
console.log("1. HTTP Fetcher desativado no dashboard.js:");
test(
  "Import de fetchMLChipsByStoreDirect está comentado",
  dashboardCode.includes("// import { fetchMLChipCountsDirect, fetchMLChipsByStoreDirect }")
);
test(
  "Não há chamada ativa de fetchMLChipsByStoreDirect",
  !dashboardCode.match(/(?<!\/\/.*)fetchMLChipsByStoreDirect\(/)
);
test(
  "Não há chamada ativa de fetchMLChipCountsDirect",
  !dashboardCode.match(/(?<!\/\/.*)fetchMLChipCountsDirect\(/)
);
console.log();

// ── 2. OAuth como fonte única ──
console.log("2. OAuth (fetchMLLiveChipBucketsDetailed) como fonte única:");
test(
  "ml_ui_chip_counts = mlLiveChipCounts (OAuth alimenta UI)",
  dashboardCode.includes("const mlUiChipCounts = mlLiveChipCounts;")
);
test(
  "chip_source: 'oauth' no payload",
  dashboardCode.includes('chip_source: "oauth"')
);
test(
  "mlUiChipCountsStale é sempre false",
  dashboardCode.includes("const mlUiChipCountsStale = false;")
);
console.log();

// ── 3. Regra ready_to_print Full preservada ──
console.log("3. Regra ready_to_print Full preservada:");
test(
  "Código contém verificação isFull para ready_to_print",
  dashboardCode.includes('if (sub === "ready_to_print")') &&
  dashboardCode.includes("if (!isFull)")
);
console.log();

// ── 4. Cache separado por conexão ──
console.log("4. Cache separado por conexão:");
test(
  "liveChipDetailedCache usa connection.id como chave",
  dashboardCode.includes('const cacheKey = String(connection?.id || connection?.seller_id || "default")')
);
test(
  "dashboardCacheByConnection usa connectionId como chave",
  dashboardCode.includes('const key = connectionId || "default"')
);
console.log();

// ── 5. Webhook invalida cache imediatamente ──
console.log("5. Webhook invalida cache imediatamente:");
test(
  "notifications.js importa invalidateDashboardCache",
  notificationsCode.includes('import { invalidateDashboardCache } from "./dashboard.js"')
);
test(
  "notifications.js importa invalidateOrdersCache",
  notificationsCode.includes('import { invalidateOrdersCache } from "./orders.js"')
);
test(
  "Cache é invalidado ANTES do sync (invalidação imediata)",
  (() => {
    // Buscar a CHAMADA (não o import) de invalidateDashboardCache
    const callIdx = notificationsCode.indexOf("invalidateDashboardCache(connection.id)");
    const syncIdx = notificationsCode.indexOf("runMercadoLivreSync({");
    return callIdx > 0 && syncIdx > 0 && callIdx < syncIdx;
  })()
);
test(
  "Webhook identifica seller_id corretamente",
  notificationsCode.includes("resolveSellerId(payload)")
);
test(
  "Webhook busca conexão por seller_id",
  notificationsCode.includes("getConnectionBySellerId(sellerId)")
);
console.log();

// ── 6. Sem dados stale ──
console.log("6. Sem dados stale na experiência do usuário:");
test(
  "Não há fallback para HTTP Fetcher no payload",
  !dashboardCode.includes("source: \"http_fetcher\"") ||
  dashboardCode.indexOf("source: \"http_fetcher\"") < dashboardCode.indexOf("DESATIVADO")
);
test(
  "Comentário explica que null = indisponível (nunca dado stale)",
  dashboardCode.includes('frontend mostra "indisponível" (nunca dado stale)')
);
console.log();

// ── 7. Bling/LojaHub não são fonte dos chips ──
console.log("7. Bling/LojaHub não são fonte dos chips:");
test(
  "Nenhuma referência a Bling como fonte de chips",
  !dashboardCode.includes("bling") || !dashboardCode.match(/bling.*chip/i)
);
console.log();

// ── Resultado ──
console.log("═══════════════════════════════════════════════════════════");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("═══════════════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
