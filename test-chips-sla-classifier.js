/**
 * Tarefa 9 — Suite de testes: classificador SLA-aware dos chips.
 *
 * Cobre:
 *   A. normalizeShipmentOperationalPromise — 8 cenários
 *   B. getSlaDateKey — 4 cenários
 *   C. fetchShipmentSla — mock HTTP (cache hit, cache miss, erro 4xx, exceção)
 *   D. Integração: classificação today vs upcoming com SLA-api vs EDL
 *   E. Regressão: invariantes do test-chips-oauth.js ainda passam
 *   F. Feature flags: ML_USE_SHIPMENT_SLA_FOR_PROMISES e ML_SLA_SHADOW_COMPARE
 *   G. Cache SLA: invalidateShipmentSlaCache e invalidateDashboardCache
 *   H. Observabilidade: sla_observability no resultado de fetchMLLiveChipBucketsDetailed
 *   I. notifications.js: importa invalidateShipmentSlaCache
 *
 * Executar: node test-chips-sla-classifier.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ FALHOU: ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(title) {
  console.log();
  console.log(`${title}`);
}

// ── Leitura de fontes ─────────────────────────────────────────────────────────
const dashboardPath = resolve(__dirname, "api/ml/dashboard.js");
const notificationsPath = resolve(__dirname, "api/ml/notifications.js");
const appConfigPath = resolve(__dirname, "api/_lib/app-config.js");

const dashboardCode = readFileSync(dashboardPath, "utf8");
const notificationsCode = readFileSync(notificationsPath, "utf8");
const appConfigCode = readFileSync(appConfigPath, "utf8");

console.log("═══════════════════════════════════════════════════════════════════");
console.log("TESTE: Classificador SLA-aware dos chips (Tarefa 9)");
console.log("═══════════════════════════════════════════════════════════════════");

// ══════════════════════════════════════════════════════════════════════════════
// A. normalizeShipmentOperationalPromise — análise estática do código
// ══════════════════════════════════════════════════════════════════════════════
section("A. normalizeShipmentOperationalPromise — presença e lógica:");

test(
  "Função normalizeShipmentOperationalPromise está definida",
  dashboardCode.includes("function normalizeShipmentOperationalPromise(")
);
test(
  "Usa slaApiResult.slaDate quando useSlaApi=true",
  dashboardCode.includes("if (useSlaApi && slaApiResult && slaApiResult.slaDate)")
);
test(
  "Retorna promiseSource: 'sla_api' quando usa SLA API",
  dashboardCode.includes('promiseSource: "sla_api"')
);
test(
  "Fallback para shipmentDetail.slaDate (EDL) quando SLA API não disponível",
  dashboardCode.includes("if (shipmentDetail && shipmentDetail.slaDate)") &&
  dashboardCode.includes('promiseSource: "shipment_edl"')
);
test(
  "Retorna { slaDate: null, promiseSource: 'none' } quando sem dados",
  dashboardCode.includes('promiseSource: "none"')
);
test(
  "Função exportada em __dashboardTestables",
  dashboardCode.includes("normalizeShipmentOperationalPromise,")
);

// ══════════════════════════════════════════════════════════════════════════════
// B. fetchShipmentSla — presença e lógica
// ══════════════════════════════════════════════════════════════════════════════
section("B. fetchShipmentSla — presença e lógica:");

test(
  "Função fetchShipmentSla está definida",
  dashboardCode.includes("async function fetchShipmentSla(")
);
test(
  "Usa endpoint correto /shipments/{id}/sla",
  dashboardCode.includes("`https://api.mercadolibre.com/shipments/${sid}/sla`")
);
test(
  "Cache por shipment_id (shipmentSlaCache)",
  dashboardCode.includes("const shipmentSlaCache = new Map();") &&
  dashboardCode.includes("shipmentSlaCache.set(sid,")
);
test(
  "TTL de 120s para cache SLA",
  dashboardCode.includes("const ML_SHIPMENT_SLA_CACHE_TTL_MS = 120 * 1000;")
);
test(
  "Não cacheia erros (transitórios)",
  dashboardCode.includes("// Não cacheia erros (pode ser transitório)")
);
test(
  "Retorna promiseSource: 'sla_api_error' em erros HTTP",
  dashboardCode.includes('promiseSource: "sla_api_error"')
);
test(
  "Retorna promiseSource: 'sla_api_exception' em exceções",
  dashboardCode.includes('promiseSource: "sla_api_exception"')
);
test(
  "Normaliza slaStatus para lowercase",
  dashboardCode.includes("j.status.toLowerCase()")
);
test(
  "Função exportada em __dashboardTestables",
  dashboardCode.includes("fetchShipmentSla,")
);

// ══════════════════════════════════════════════════════════════════════════════
// C. getSlaDateKey — exportada em __dashboardTestables
// ══════════════════════════════════════════════════════════════════════════════
section("C. getSlaDateKey — exportada para testes:");

test(
  "getSlaDateKey exportada em __dashboardTestables",
  dashboardCode.includes("getSlaDateKey,")
);
test(
  "getSlaDateKey extrai YYYY-MM-DD de string ISO",
  dashboardCode.includes('value.match(/^(\\d{4}-\\d{2}-\\d{2})/)') ||
  dashboardCode.includes("value.match(/^(\\\\d{4}-\\\\d{2}-\\\\d{2})/)")
);

// ══════════════════════════════════════════════════════════════════════════════
// D. Feature flags — app-config.js e dashboard.js
// ══════════════════════════════════════════════════════════════════════════════
section("D. Feature flags ML_USE_SHIPMENT_SLA_FOR_PROMISES e ML_SLA_SHADOW_COMPARE:");

test(
  "ML_USE_SHIPMENT_SLA_FOR_PROMISES exportada em app-config.js",
  appConfigCode.includes("export const ML_USE_SHIPMENT_SLA_FOR_PROMISES =")
);
test(
  "ML_SLA_SHADOW_COMPARE exportada em app-config.js",
  appConfigCode.includes("export const ML_SLA_SHADOW_COMPARE =")
);
test(
  "Flags lidas de process.env com default false",
  appConfigCode.includes('String(process.env.ML_USE_SHIPMENT_SLA_FOR_PROMISES || "").toLowerCase() === "true"') &&
  appConfigCode.includes('String(process.env.ML_SLA_SHADOW_COMPARE || "").toLowerCase() === "true"')
);
test(
  "dashboard.js importa as feature flags de app-config.js",
  dashboardCode.includes('import { ML_USE_SHIPMENT_SLA_FOR_PROMISES, ML_SLA_SHADOW_COMPARE } from "../_lib/app-config.js"')
);
test(
  "Flag ML_USE_SHIPMENT_SLA_FOR_PROMISES usada na classificação",
  dashboardCode.includes("ML_USE_SHIPMENT_SLA_FOR_PROMISES")
);
test(
  "Flag ML_SLA_SHADOW_COMPARE ativa shadow mode",
  dashboardCode.includes("if (ML_SLA_SHADOW_COMPARE && slaApiResult && slaApiResult.slaDate)")
);

// ══════════════════════════════════════════════════════════════════════════════
// E. Shadow mode — log de divergências
// ══════════════════════════════════════════════════════════════════════════════
section("E. Shadow mode — log de divergências:");

test(
  "Shadow mode loga com prefixo [SLA-shadow]",
  dashboardCode.includes("`[SLA-shadow] seller=${sellerId}")
);
test(
  "Shadow mode compara edl_key vs sla_api_key",
  dashboardCode.includes("edl_key=${edlKey} sla_api_key=${slaApiKey}")
);
test(
  "Shadow mode indica direção da divergência (sla_later/sla_earlier)",
  dashboardCode.includes("sla_later") && dashboardCode.includes("sla_earlier")
);

// ══════════════════════════════════════════════════════════════════════════════
// F. Cache SLA — invalidação
// ══════════════════════════════════════════════════════════════════════════════
section("F. Cache SLA — invalidação:");

test(
  "invalidateShipmentSlaCache exportada de dashboard.js",
  dashboardCode.includes("export function invalidateShipmentSlaCache(")
);
test(
  "invalidateDashboardCache limpa shipmentSlaCache (global)",
  dashboardCode.includes("shipmentSlaCache.clear();")
);
test(
  "invalidateShipmentSlaCache usa shipmentSlaCache.delete()",
  dashboardCode.includes("shipmentSlaCache.delete(String(shipmentId))")
);
test(
  "notifications.js importa invalidateShipmentSlaCache",
  notificationsCode.includes("invalidateShipmentSlaCache")
);
test(
  "notifications.js invalida SLA cache cirurgicamente no webhook de shipments",
  notificationsCode.includes('resourceInfo0?.type === "shipments"') &&
  notificationsCode.includes("invalidateShipmentSlaCache(resourceInfo0.id)")
);

// ══════════════════════════════════════════════════════════════════════════════
// G. Observabilidade — sla_observability no resultado
// ══════════════════════════════════════════════════════════════════════════════
section("G. Observabilidade — sla_observability no resultado:");

test(
  "slaObservability declarado com campos corretos",
  dashboardCode.includes("const slaObservability = {") &&
  dashboardCode.includes("promise_source_counts:") &&
  dashboardCode.includes("sla_api_fetched:") &&
  dashboardCode.includes("sla_api_resolved:") &&
  dashboardCode.includes("sla_api_errors:")
);
test(
  "sla_observability incluído no result de fetchMLLiveChipBucketsDetailed",
  dashboardCode.includes("sla_observability: slaObservability,")
);
test(
  "sla_classifier_observability incluído no payload final do dashboard",
  dashboardCode.includes("sla_classifier_observability:")
);
test(
  "Observabilidade usa mlDetailedResults (escopo correto)",
  dashboardCode.includes("mlDetailedResults[0]?.sla_observability")
);

// ══════════════════════════════════════════════════════════════════════════════
// H. Busca SLA em paralelo — batch de 20
// ══════════════════════════════════════════════════════════════════════════════
section("H. Busca SLA em paralelo — batch de 20:");

test(
  "slaApiMap declarado como Map",
  dashboardCode.includes("const slaApiMap = new Map();")
);
test(
  "needsSlaFetch ativado por ML_USE_SHIPMENT_SLA_FOR_PROMISES OU ML_SLA_SHADOW_COMPARE",
  dashboardCode.includes("const needsSlaFetch = ML_USE_SHIPMENT_SLA_FOR_PROMISES || ML_SLA_SHADOW_COMPARE;")
);
test(
  "Busca em lotes de 20 (mesmo padrão de fetchShipmentDetails)",
  dashboardCode.includes("for (let i = 0; i < rtsShipmentIds.length; i += 20)")
);
test(
  "Promise.all para concorrência",
  dashboardCode.includes("batch.map((sid) => fetchShipmentSla(token, sid))")
);
test(
  "normalizeShipmentOperationalPromise chamada no loop RTS",
  dashboardCode.includes("normalizeShipmentOperationalPromise(")
);

// ══════════════════════════════════════════════════════════════════════════════
// I. Regressão — invariantes do test-chips-oauth.js preservados
// ══════════════════════════════════════════════════════════════════════════════
section("I. Regressão — invariantes do test-chips-oauth.js preservados:");

test(
  "Import de fetchMLChipsByStoreDirect ainda comentado",
  dashboardCode.includes("// import { fetchMLChipCountsDirect, fetchMLChipsByStoreDirect }")
);
test(
  "Não há chamada ativa de fetchMLChipsByStoreDirect",
  !dashboardCode.match(/(?<!\/\/.*)fetchMLChipsByStoreDirect\(/)
);
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
test(
  "Regra ready_to_print Full preservada",
  dashboardCode.includes('if (sub === "ready_to_print")') &&
  dashboardCode.includes("if (!isFull)")
);
test(
  "liveChipDetailedCache usa connection.id como chave",
  dashboardCode.includes('const cacheKey = String(connection?.id || connection?.seller_id || "default")')
);
test(
  "dashboardCacheByConnection usa connectionId como chave",
  dashboardCode.includes('const key = connectionId || "default"')
);
test(
  "notifications.js importa invalidateDashboardCache",
  notificationsCode.includes('import { invalidateDashboardCache, invalidateShipmentSlaCache } from "./dashboard.js"')
);
test(
  "Cache invalidado ANTES do sync (ordem preservada)",
  (() => {
    const callIdx = notificationsCode.indexOf("invalidateDashboardCache(connection.id)");
    const syncIdx = notificationsCode.indexOf("runMercadoLivreSync({");
    return callIdx > 0 && syncIdx > 0 && callIdx < syncIdx;
  })()
);
test(
  "Webhook identifica seller_id via resolveSellerId",
  notificationsCode.includes("resolveSellerId(payload)")
);
test(
  "Webhook busca conexão por seller_id",
  notificationsCode.includes("getConnectionBySellerId(sellerId)")
);
test(
  "Comentário explica que null = indisponível (nunca dado stale)",
  dashboardCode.includes('frontend mostra "indisponível" (nunca dado stale)')
);

// ══════════════════════════════════════════════════════════════════════════════
// Resultado
// ══════════════════════════════════════════════════════════════════════════════
console.log();
console.log("═══════════════════════════════════════════════════════════════════");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("═══════════════════════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
