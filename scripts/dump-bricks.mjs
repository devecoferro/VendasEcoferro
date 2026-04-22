import fs from "node:fs";
const r = JSON.parse(fs.readFileSync("/tmp/scrape-result.json", "utf8"));

const tab = "upcoming";
const store = "all";
const xhrs = r.tabs?.[tab]?.[store]?.xhr_responses || [];
const eventReqs = xhrs.filter(x => /channels\/event-request/.test(x.url || ""));
console.log(`event-request XHRs em ${tab}/${store}: ${eventReqs.length}\n`);

// Lista TODOS os brick ids em TODOS os event-requests
const brickSummary = new Map();
let orderIdsFound = new Set();

for (const [idx, x] of eventReqs.entries()) {
  const resp = x.body?.response;
  if (!Array.isArray(resp)) continue;
  for (const ev of resp) {
    const bricks = ev?.data?.bricks || [];
    for (const b of bricks) {
      const id = b?.id || "?";
      const ui = b?.uiType || "?";
      const dataKeys = Object.keys(b?.data || {}).join(",");
      const key = `${ui}|${id}|${dataKeys}`;
      brickSummary.set(key, (brickSummary.get(key) || 0) + 1);
      // Procura order IDs numericos (13 digits) em qualquer lugar do brick
      const str = JSON.stringify(b);
      const matches = str.match(/\b2000\d{10}\b/g); // ML order IDs comecam com 2000
      if (matches) {
        for (const m of matches) orderIdsFound.add(m);
      }
    }
  }
}

console.log("=== Todos os bricks encontrados ===");
for (const [k, n] of [...brickSummary.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${n}x  ${k}`);
}

console.log(`\nOrder IDs encontrados (regex /2000\\d{10}/): ${orderIdsFound.size}`);
console.log("Sample:", [...orderIdsFound].slice(0, 10).join(", "));
