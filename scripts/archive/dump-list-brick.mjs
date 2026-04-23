import fs from "node:fs";
const r = JSON.parse(fs.readFileSync("/tmp/scrape-result.json", "utf8"));

const tab = "upcoming";
const store = "all";
const xhrs = r.tabs?.[tab]?.[store]?.xhr_responses || [];
const eventReqs = xhrs.filter(x => /channels\/event-request/.test(x.url || ""));

// Encontra o brick list_marketshops com mais conteudo
let best = null;
for (const x of eventReqs) {
  const resp = x.body?.response;
  if (!Array.isArray(resp)) continue;
  for (const ev of resp) {
    const bricks = ev?.data?.bricks || [];
    for (const b of bricks) {
      if (b?.id === "list_marketshops") {
        const size = JSON.stringify(b).length;
        if (!best || size > best.size) best = { brick: b, size };
      }
    }
  }
}

if (!best) { console.log("sem list_marketshops"); process.exit(0); }

console.log(`list_marketshops maior (${best.size} chars):`);
console.log(JSON.stringify(best.brick, null, 2).slice(0, 8000));
