// Post-hoc analyzer dos snapshots capturados em tmp-ml-audit3/.
// Identifica endpoints do ML que foram interceptados, agrupa por path,
// e extrai estrutura de payloads interessantes (/actions, /tabs, etc.).
//
// Uso: node scripts/analyze-captured-xhrs.mjs

import fs from "node:fs";
import path from "node:path";

const INPUT_DIR = path.join(process.cwd(), "tmp-ml-audit3");
if (!fs.existsSync(INPUT_DIR)) {
  console.error(`Diretorio nao encontrado: ${INPUT_DIR}`);
  console.error("Rode primeiro: node scripts/capture-private-seller-center-snapshots.mjs --headless --all-tabs --skip-post");
  process.exit(1);
}

const files = fs
  .readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith(".json") && f !== "_aggregate.json");

console.log(`Analisando ${files.length} snapshots em ${INPUT_DIR}\n`);

// Agregados
const endpointsByPath = new Map();
const actionsPayloads = [];
const tabsPayloads = [];
const subFiltersAll = new Set();
const sortsAll = new Set();
const totalPagesCaptured = [];

for (const file of files) {
  const full = path.join(INPUT_DIR, file);
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    console.warn(`  [skip] ${file}: json invalido (${e.message})`);
    continue;
  }

  for (const sf of snap.sub_filters_observed || []) subFiltersAll.add(sf);
  for (const so of snap.sorts_observed || []) sortsAll.add(so);
  totalPagesCaptured.push({
    tab: snap.selected_tab,
    store: snap.store,
    pages: snap.pages_captured,
    tab_counts: snap.tab_counts,
  });

  const responses = snap.raw_payload?.responses || [];
  for (const resp of responses) {
    const url = resp.url || "";
    if (!url.startsWith("http")) continue;
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!pathname.includes("mercadolivre") && !pathname.includes("mercadolibre") && !pathname.startsWith("/")) {
      // Mantém só endpoints do ML
    }
    const count = endpointsByPath.get(pathname) || { hits: 0, examples: [], status_codes: new Set() };
    count.hits += 1;
    if (count.examples.length < 3) count.examples.push(url);
    if (resp.status) count.status_codes.add(resp.status);
    endpointsByPath.set(pathname, count);

    if (pathname.includes("operations-dashboard/actions")) {
      actionsPayloads.push({ url, status: resp.status, body: resp.body, snapshot: file });
    }
    if (pathname.includes("operations-dashboard/tabs")) {
      tabsPayloads.push({ url, status: resp.status, body: resp.body, snapshot: file });
    }
  }
}

console.log("=== PÁGINAS CAPTURADAS (comparar com offset=0 anterior que pegava 1) ===\n");
for (const p of totalPagesCaptured) {
  console.log(
    `  ${p.tab.padEnd(18)} ${p.store.padEnd(12)} ${String(p.pages).padStart(3)} pags  counts=${JSON.stringify(p.tab_counts)}`
  );
}

console.log("\n=== ENDPOINTS ML INTERCEPTADOS (top 30 por hits) ===\n");
const sortedEndpoints = [...endpointsByPath.entries()]
  .sort(([, a], [, b]) => b.hits - a.hits)
  .slice(0, 30);
for (const [p, info] of sortedEndpoints) {
  console.log(
    `  ${String(info.hits).padStart(4)}×  [${[...info.status_codes].join(",")}]  ${p}`
  );
}

console.log("\n=== Z3: subFilters únicos observados ===");
console.log(`Total: ${subFiltersAll.size}`);
for (const sf of [...subFiltersAll].sort()) {
  console.log(`  ${sf}`);
}

console.log("\n=== Z3: sorts únicos observados ===");
console.log(`Total: ${sortsAll.size}`);
for (const so of [...sortsAll].sort()) {
  console.log(`  ${so}`);
}

console.log("\n=== Z4: /operations-dashboard/actions — interceptado? ===");
if (actionsPayloads.length === 0) {
  console.log(`  NENHUM hit em ${files.length} snapshots.`);
  console.log(`  Conclusão: endpoint nao e chamado na navegacao passiva das tabs.`);
  console.log(`  Hipoteses: (a) so e chamado em acoes ativas (clicar botao), (b) deprecated.`);
  console.log(`  Proximo passo: rodar --headed e clicar em acoes globais manualmente.`);
} else {
  console.log(`  ${actionsPayloads.length} hits encontrados. Salvando primeiro em tmp-ml-audit3/actions-sample.json`);
  fs.writeFileSync(
    path.join(INPUT_DIR, "actions-sample.json"),
    JSON.stringify(actionsPayloads[0], null, 2)
  );
  for (const p of actionsPayloads.slice(0, 3)) {
    console.log(`  [${p.status}] ${p.url.slice(0, 120)}`);
  }
}

console.log("\n=== /operations-dashboard/tabs — interceptado? ===");
if (tabsPayloads.length === 0) {
  console.log(`  NENHUM hit. (Esperado — pode usar outro path agora.)`);
} else {
  console.log(`  ${tabsPayloads.length} hits. Salvando em tmp-ml-audit3/tabs-sample.json`);
  fs.writeFileSync(
    path.join(INPUT_DIR, "tabs-sample.json"),
    JSON.stringify(tabsPayloads[0], null, 2)
  );
}
