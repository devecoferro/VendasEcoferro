// Dispara hardHealDrift (re-fetch individual GET /orders/{id} + /shipments/{id}
// sobrescrevendo raw_data no DB) e imprime resultado como JSON.
//
// Usado em producao pra corrigir drift persistente entre counts_local e chips ML.
// Roda via: docker exec <container> node scripts/trigger-hard-heal.mjs [max]

import { hardHealDrift } from "../api/ml/diagnostics.js";

const maxArg = Number(process.argv[2] || 500);
const maxOrdersToRefresh = Number.isFinite(maxArg) && maxArg > 0 ? Math.min(maxArg, 1000) : 500;

console.log(`[trigger-hard-heal] iniciando — maxOrdersToRefresh=${maxOrdersToRefresh}`);
const start = Date.now();

try {
  const result = await hardHealDrift({ tolerance: 2, maxOrdersToRefresh });
  const durationMs = Date.now() - start;
  console.log(`[trigger-hard-heal] concluido em ${durationMs}ms`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.healed ? 0 : 2);
} catch (err) {
  console.error("[trigger-hard-heal] erro:", err?.message || err);
  console.error(err?.stack || "");
  process.exit(1);
}
