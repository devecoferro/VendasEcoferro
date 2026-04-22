// Dispara scraper ML Seller Center e loga resultados.
// Roda dentro do container: node /app/trigger-scraper.mjs
import {
  scrapeMlSellerCenterFull,
  getCachedFullResult,
} from "/app/api/ml/_lib/seller-center-scraper.js";

console.log("=== Iniciando scraper completo ===");
const start = Date.now();

try {
  const result = await scrapeMlSellerCenterFull({
    timeoutMs: 90_000,
    stores: ["all"], // so "all" pra economizar tempo — cobre todos os deposits
  });
  const ms = Date.now() - start;
  console.log(`Scraper terminou em ${(ms / 1000).toFixed(1)}s`);

  console.log("\nchipCounts:", JSON.stringify(result?.chipCounts || result?.counts, null, 2));

  // Lista as tabs capturadas
  if (result?.snapshots) {
    for (const s of result.snapshots) {
      console.log(`\n--- ${s.store || s.scope} / ${s.tab || s.selectedTab}`);
      const list = s.list || s.orders || s.items || [];
      console.log(`  ${list.length} orders`);
      for (const o of list.slice(0, 3)) {
        const id = o.order_id || o.orderId || o.id || o.packId;
        console.log(`    - ${id}  ${JSON.stringify(o).slice(0, 200)}`);
      }
    }
  } else {
    console.log("\n(sem snapshots no resultado)");
    console.log("Result keys:", Object.keys(result || {}));
    console.log("Result sample:", JSON.stringify(result, null, 2).slice(0, 3000));
  }
} catch (e) {
  console.error("ERRO:", e.message);
  console.error(e.stack);
}
