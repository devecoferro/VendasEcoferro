import { getCachedFullResult } from "/app/api/ml/_lib/seller-center-scraper.js";

const r = getCachedFullResult();
if (!r) { console.log("sem cache"); process.exit(0); }

// Pega só o upcoming × all
const up = r.tabs?.upcoming?.all;
if (!up) { console.log("sem upcoming × all"); process.exit(0); }

const xhrs = up.xhr_responses || [];
console.log(`total XHRs em upcoming × all: ${xhrs.length}\n`);
for (const x of xhrs) {
  const url = (x.url || "").slice(0, 150);
  const bodyKind = Array.isArray(x.body) ? `array(${x.body.length})` : (typeof x.body === "object" && x.body ? `obj(${Object.keys(x.body).slice(0,6).join(",")})` : typeof x.body);
  console.log(`  [${x.status}] ${url}  -> ${bodyKind}`);
}

// Mostra body do primeiro XHR com body tipo array ou com "results"/"items"/"list"/"packs"
console.log("\n=== Candidatos a lista de pedidos ===");
for (const x of xhrs) {
  const b = x.body;
  if (!b || typeof b !== "object") continue;
  const isList = Array.isArray(b)
    || Array.isArray(b.results)
    || Array.isArray(b.items)
    || Array.isArray(b.list)
    || Array.isArray(b.packs)
    || Array.isArray(b.orders)
    || Array.isArray(b.data?.results)
    || Array.isArray(b.data?.items);
  if (!isList) continue;
  console.log(`\nURL: ${x.url}`);
  console.log(`Body keys: ${Object.keys(b).slice(0,15).join(", ")}`);
  const firstArr = Array.isArray(b) ? b : (b.results || b.items || b.list || b.packs || b.orders || b.data?.results || b.data?.items);
  console.log(`Array len: ${firstArr.length}`);
  if (firstArr.length > 0) {
    console.log(`First item keys: ${Object.keys(firstArr[0] || {}).slice(0,15).join(", ")}`);
    console.log(`First item: ${JSON.stringify(firstArr[0], null, 2).slice(0, 1500)}`);
  }
}
