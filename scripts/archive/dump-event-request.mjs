// Inspeciona o body de um channels/event-request do scraper para
// descobrir onde ML esconde a lista de pedidos
import fs from "node:fs";
const r = JSON.parse(fs.readFileSync("/tmp/scrape-result.json", "utf8"));

const tab = "upcoming";
const store = "all";
const xhrs = r.tabs?.[tab]?.[store]?.xhr_responses || [];
const eventReqs = xhrs.filter(x => /channels\/event-request/.test(x.url || ""));
console.log(`event-request XHRs em ${tab}/${store}: ${eventReqs.length}\n`);

for (let i = 0; i < Math.min(3, eventReqs.length); i++) {
  const x = eventReqs[i];
  console.log(`\n=== event-request #${i+1} ===`);
  console.log(`URL: ${x.url}`);
  const body = x.body;
  if (!body) { console.log("  sem body"); continue; }
  console.log(`Top-level keys: ${Object.keys(body).slice(0,10).join(", ")}`);
  // body.response geralmente e um array de events (eventos da UI)
  const resp = body.response;
  if (Array.isArray(resp)) {
    console.log(`response[] len: ${resp.length}`);
    for (let j = 0; j < Math.min(3, resp.length); j++) {
      const ev = resp[j];
      console.log(`  event[${j}]: type=${ev.type} keys=${Object.keys(ev).slice(0,8).join(",")}`);
      if (ev.data) {
        const dk = Object.keys(ev.data).slice(0, 10).join(",");
        console.log(`    data keys: ${dk}`);
      }
    }
    // Procura event.data.bricks ou event.data.items com estrutura de pedido
    for (const ev of resp) {
      if (!ev?.data) continue;
      // events tipo update_bricks com bricks array
      const bricks = ev.data.bricks || ev.data.content?.bricks;
      if (!Array.isArray(bricks)) continue;
      for (const b of bricks) {
        if (!b?.data) continue;
        // Bricks com id 'marketshops' ou com items
        if (b.id === "marketshops" || b.id?.includes("list") || Array.isArray(b.data?.items) || Array.isArray(b.data?.packs)) {
          console.log(`\n    BRICK ${b.id} (uiType=${b.uiType}):`);
          const items = b.data?.items || b.data?.packs || b.data?.orders || [];
          console.log(`      items: ${items.length}`);
          if (items.length > 0) {
            console.log(`      item sample: ${JSON.stringify(items[0]).slice(0, 800)}`);
          } else {
            console.log(`      data keys: ${Object.keys(b.data).slice(0, 15).join(", ")}`);
            console.log(`      data sample: ${JSON.stringify(b.data).slice(0, 800)}`);
          }
        }
      }
    }
  } else {
    console.log(`response type: ${typeof resp}`);
  }
}
