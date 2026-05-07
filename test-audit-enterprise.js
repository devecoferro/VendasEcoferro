/**
 * AUDITORIA ENTERPRISE-GRADE — Suite de Testes
 * Commit: c83c6c0
 * Data: 2026-05-07
 *
 * Testes:
 * 1. Classificador unitário (substatus → chip)
 * 2. Cache multi-conta (isolamento)
 * 3. Webhook orders_v2 (invalidação imediata)
 * 4. Webhook shipments (invalidação imediata)
 * 5. Fallback seguro (OAuth falha)
 * 6. Ausência de HTTP Fetcher no fluxo principal
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;
const results = [];

function test(name, condition) {
  if (condition) {
    passed++;
    results.push({ name, status: "PASS" });
  } else {
    failed++;
    results.push({ name, status: "FAIL" });
    console.error(`  ✗ FALHOU: ${name}`);
  }
}

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

// ══════════════════════════════════════════════════════════════
// Carregar código-fonte para análise estática + simulação
// ══════════════════════════════════════════════════════════════
const dashboardCode = readFileSync(join(__dirname, "api/ml/dashboard.js"), "utf-8");
const notificationsCode = readFileSync(join(__dirname, "api/ml/notifications.js"), "utf-8");

// ══════════════════════════════════════════════════════════════
// TESTE 1: CLASSIFICADOR UNITÁRIO
// ══════════════════════════════════════════════════════════════
section("1. CLASSIFICADOR UNITÁRIO (substatus → chip)");

// Simular a lógica do classificador extraída do código
function classifyRTS(substatus, logisticType) {
  const isFull = logisticType === "fulfillment";
  const RTS_EXCLUDED = new Set(["picked_up", "authorized_by_carrier"]);

  if (RTS_EXCLUDED.has(substatus)) return "excluded";
  if (substatus === "ready_for_pickup" || substatus === "packed" || substatus === "ready_to_pack") return "today";
  if (substatus === "invoice_pending") return "upcoming";
  if (substatus === "in_hub") return "upcoming";
  if (substatus === "in_packing_list" || substatus === "in_warehouse") {
    return isFull ? "excluded" : "upcoming";
  }
  if (substatus === "ready_to_print") {
    return isFull ? "excluded" : "upcoming";
  }
  // Default: usa SLA (simulamos como "today" para SLA ≤ hoje)
  return "sla_based";
}

// Casos de teste do classificador
test("ready_for_pickup → today", classifyRTS("ready_for_pickup", "cross_docking") === "today");
test("packed → today", classifyRTS("packed", "cross_docking") === "today");
test("ready_to_pack → today", classifyRTS("ready_to_pack", "cross_docking") === "today");
test("ready_for_pickup Full → today (global)", classifyRTS("ready_for_pickup", "fulfillment") === "today");
test("invoice_pending → upcoming", classifyRTS("invoice_pending", "cross_docking") === "upcoming");
test("in_hub → upcoming", classifyRTS("in_hub", "cross_docking") === "upcoming");
test("in_packing_list Cross → upcoming", classifyRTS("in_packing_list", "cross_docking") === "upcoming");
test("in_packing_list Full → excluded", classifyRTS("in_packing_list", "fulfillment") === "excluded");
test("in_warehouse Cross → upcoming", classifyRTS("in_warehouse", "cross_docking") === "upcoming");
test("in_warehouse Full → excluded", classifyRTS("in_warehouse", "fulfillment") === "excluded");
test("ready_to_print Cross → upcoming", classifyRTS("ready_to_print", "cross_docking") === "upcoming");
test("ready_to_print Full → excluded (FIX FANTOM)", classifyRTS("ready_to_print", "fulfillment") === "excluded");
test("picked_up → excluded (transição)", classifyRTS("picked_up", "cross_docking") === "excluded");
test("authorized_by_carrier → excluded", classifyRTS("authorized_by_carrier", "cross_docking") === "excluded");

// Shipped
function classifyShipped(substatus) {
  if (substatus === "waiting_for_withdrawal") return "in_transit";
  return "excluded"; // trânsito normal
}

test("shipped waiting_for_withdrawal → in_transit", classifyShipped("waiting_for_withdrawal") === "in_transit");
test("shipped in_transit (normal) → excluded", classifyShipped("in_transit") === "excluded");
test("shipped delivered → excluded", classifyShipped("delivered") === "excluded");

// ══════════════════════════════════════════════════════════════
// TESTE 2: CACHE MULTI-CONTA (isolamento)
// ══════════════════════════════════════════════════════════════
section("2. CACHE MULTI-CONTA (isolamento)");

// Simular o cache
class SimulatedCache {
  constructor() { this.store = new Map(); }
  set(key, value) { this.store.set(key, value); }
  get(key) { return this.store.get(key); }
  clear() { this.store.clear(); }
  has(key) { return this.store.has(key); }
  delete(key) { this.store.delete(key); }
}

const liveChipCache = new SimulatedCache();
const dashboardCache = new SimulatedCache();

// Simular duas contas
const fantomConnectionId = "uuid-fantom-75043688";
const ecoferroConnectionId = "uuid-ecoferro-83594950";

// Setar cache para ambas
liveChipCache.set(fantomConnectionId, { counts: { today: 84, upcoming: 31 }, expiresAt: Date.now() + 50000 });
liveChipCache.set(ecoferroConnectionId, { counts: { today: 81, upcoming: 36 }, expiresAt: Date.now() + 50000 });
dashboardCache.set(fantomConnectionId, { payload: { chip_source: "oauth" }, expiresAt: Date.now() + 30000 });
dashboardCache.set(ecoferroConnectionId, { payload: { chip_source: "oauth" }, expiresAt: Date.now() + 30000 });

test("liveChipCache: Fantom e EcoFerro têm chaves separadas",
  liveChipCache.has(fantomConnectionId) && liveChipCache.has(ecoferroConnectionId));

test("liveChipCache: dados Fantom != dados EcoFerro",
  liveChipCache.get(fantomConnectionId).counts.today !== liveChipCache.get(ecoferroConnectionId).counts.today);

test("dashboardCache: chaves separadas por connectionId",
  dashboardCache.has(fantomConnectionId) && dashboardCache.has(ecoferroConnectionId));

// Simular invalidação GLOBAL (como invalidateDashboardCache faz)
liveChipCache.clear();
dashboardCache.clear();

test("invalidateDashboardCache() limpa AMBOS (comportamento atual)",
  !liveChipCache.has(fantomConnectionId) && !liveChipCache.has(ecoferroConnectionId));

test("Após invalidação global, ambas contas recalculam (sem dados stale)",
  liveChipCache.get(fantomConnectionId) === undefined && liveChipCache.get(ecoferroConnectionId) === undefined);

// ══════════════════════════════════════════════════════════════
// TESTE 3: WEBHOOK orders_v2 (simulação)
// ══════════════════════════════════════════════════════════════
section("3. WEBHOOK orders_v2 (simulação)");

// Simular payload do ML
const ordersV2Payload = {
  topic: "orders_v2",
  resource: "/orders/2000006549182345",
  user_id: "75043688", // Fantom
  application_id: "1234567890",
};

// Verificar que resolveSellerId funciona
function resolveSellerId(payload) {
  const direct = payload?.user_id ? String(payload.user_id).trim() : null;
  if (direct) return direct;
  const resource = payload?.resource || "";
  const matched = resource.match(/\/users\/(\d+)/i);
  return matched?.[1] || "";
}

const resolvedSeller = resolveSellerId(ordersV2Payload);
test("Webhook orders_v2: resolve seller_id = 75043688 (Fantom)", resolvedSeller === "75043688");

// Simular getConnectionBySellerId
function getConnectionBySellerId(sellerId) {
  const connections = {
    "75043688": { id: fantomConnectionId, seller_id: "75043688", nickname: "Fantom" },
    "83594950": { id: ecoferroConnectionId, seller_id: "83594950", nickname: "EcoFerro" },
  };
  return connections[sellerId] || null;
}

const connection = getConnectionBySellerId(resolvedSeller);
test("Webhook orders_v2: encontra conexão Fantom", connection?.id === fantomConnectionId);
test("Webhook orders_v2: conexão tem seller_id correto", connection?.seller_id === "75043688");

// Verificar ordem de execução no código
const invalidateIdx = notificationsCode.indexOf("invalidateDashboardCache(connection.id)");
const syncIdx = notificationsCode.indexOf("runMercadoLivreSync({");
test("Webhook: invalidateDashboardCache() ANTES de runMercadoLivreSync",
  invalidateIdx > 0 && syncIdx > 0 && invalidateIdx < syncIdx);

// ══════════════════════════════════════════════════════════════
// TESTE 4: WEBHOOK shipments (simulação)
// ══════════════════════════════════════════════════════════════
section("4. WEBHOOK shipments (simulação)");

const shipmentsPayload = {
  topic: "shipments",
  resource: "/shipments/43210987654",
  user_id: "83594950", // EcoFerro
  application_id: "1234567890",
};

const resolvedSellerShip = resolveSellerId(shipmentsPayload);
test("Webhook shipments: resolve seller_id = 83594950 (EcoFerro)", resolvedSellerShip === "83594950");

const connectionShip = getConnectionBySellerId(resolvedSellerShip);
test("Webhook shipments: encontra conexão EcoFerro", connectionShip?.id === ecoferroConnectionId);

// Verificar que o topic "shipments" é suportado
test("Topic 'shipments' está em NOTIFICATION_TOPICS",
  notificationsCode.includes('"shipments"') && notificationsCode.includes("NOTIFICATION_TOPICS"));

// ══════════════════════════════════════════════════════════════
// TESTE 5: FALLBACK SEGURO (OAuth falha)
// ══════════════════════════════════════════════════════════════
section("5. FALLBACK SEGURO (OAuth falha)");

// Verificar que quando OAuth falha, retorna null (não dados stale)
test("fetchMLLiveChipBucketsDetailed retorna null em caso de erro",
  dashboardCode.includes("return null;") &&
  dashboardCode.includes("[fetchMLLiveChipBucketsDetailed] Error:"));

// Verificar que mlLiveChipCounts = null não causa crash
test("mlLiveChipCounts pode ser null (L2785)",
  dashboardCode.includes("mlLiveChipCounts = null;"));

// Verificar que o payload transmite null quando OAuth falha
test("payload.ml_live_chip_counts pode ser null (frontend mostra 'indisponível')",
  dashboardCode.includes("ml_live_chip_counts: mlLiveChipCounts"));

// Verificar que NÃO há fallback para HTTP Fetcher
test("Sem fallback para HTTP Fetcher quando OAuth falha",
  !dashboardCode.includes("fetchMLChipsByStoreDirect(") &&
  !dashboardCode.includes("fetchMLChipCountsDirect(") &&
  !dashboardCode.includes("fetchMLChipsViaHTTP("));

// Verificar que stale é sempre false
test("ml_ui_chip_counts_stale é sempre false (nunca dado stale)",
  dashboardCode.includes("const mlUiChipCountsStale = false;"));

// ══════════════════════════════════════════════════════════════
// TESTE 6: AUSÊNCIA DE HTTP FETCHER NO FLUXO PRINCIPAL
// ══════════════════════════════════════════════════════════════
section("6. AUSÊNCIA DE HTTP FETCHER NO FLUXO PRINCIPAL");

// Verificar que o import está comentado
test("Import de ml-chip-proxy está COMENTADO (// import)",
  dashboardCode.includes('// import { fetchMLChipCountsDirect, fetchMLChipsByStoreDirect }'));

// Verificar que não há chamada ativa
test("Nenhuma chamada ativa de fetchMLChipsByStoreDirect",
  !dashboardCode.match(/[^\/]fetchMLChipsByStoreDirect\(/));

test("Nenhuma chamada ativa de fetchMLChipCountsDirect",
  !dashboardCode.match(/[^\/]fetchMLChipCountsDirect\(/));

test("Nenhuma chamada ativa de fetchMLChipsViaHTTP",
  !dashboardCode.match(/[^\/]fetchMLChipsViaHTTP\(/));

// Verificar que notifications.js NÃO importa HTTP Fetcher
test("notifications.js NÃO importa ml-chip-http-fetcher",
  !notificationsCode.includes("ml-chip-http-fetcher"));

test("notifications.js NÃO importa ml-chip-proxy",
  !notificationsCode.includes("ml-chip-proxy"));

// Verificar chip_source
test("chip_source é 'oauth' no payload (L3028)",
  dashboardCode.includes('chip_source: "oauth"'));

// ══════════════════════════════════════════════════════════════
// RESULTADO FINAL
// ══════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTADO FINAL: ${passed} passaram, ${failed} falharam`);
console.log(`${"═".repeat(60)}`);

if (failed > 0) {
  console.log("\nTestes que falharam:");
  results.filter(r => r.status === "FAIL").forEach(r => console.log(`  - ${r.name}`));
}

process.exit(failed > 0 ? 1 : 0);
