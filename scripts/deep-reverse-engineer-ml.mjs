// ─── Engenharia reversa avançada do ML Seller Center (v2) ────────────
//
// Usa o sistema "bricks" do ML (descoberto via debug-ml-dom-dump):
// cada XHR `/vendas/omni/lista/api/channels/event-request` retorna árvore
// de bricks com `dashboard_operations_card` + `dashboard_operations_task`.
//
// Pra cada (depósito × tab), navega, registra XHR ANTES de goto, parseia
// bricks e extrai:
//   - Cards (ID, tag, label, count)
//   - Tasks (ID, label, quantity)
//   - Tabs + counts (segmented_actions)
//   - Filter dates (opções do dropdown)
//   - Buttons via DOM
//
// Saída:
//   data/reverse-engineering/<date>/
//     summary.md
//     <store>/<tab>/
//       bricks.json       — payload bricks (cards + tasks estruturados)
//       dom.json          — estrutura DOM (botões, dropdowns)
//       xhrs.json         — XHRs relevantes
//       screenshot.png
//       meta.json
//
// Uso:
//   node scripts/deep-reverse-engineer-ml.mjs [--stores all,ourinhos,full,unknown] [--headed]

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// ─── Config ────────────────────────────────────────────────────────────
const STORE_VIEWS = [
  { key: "all", store: "all", label: "Todas as vendas" },
  { key: "unknown", store: "unknown", label: "Vendas sem deposito" },
  { key: "ourinhos", store: "79856028", label: "Ourinhos Rua Dario Alonso" },
  { key: "full", store: "full", label: "Full" },
];

const TABS = [
  { key: "today", id: "TAB_TODAY", label: "Envios de hoje" },
  { key: "next_days", id: "TAB_NEXT_DAYS", label: "Proximos dias" },
  { key: "in_the_way", id: "TAB_IN_THE_WAY", label: "Em transito" },
  { key: "finished", id: "TAB_FINISHED", label: "Finalizadas" },
];

const BASE_URL = "https://www.mercadolivre.com.br/vendas/omni/lista";
const STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "playwright",
  "private-seller-center.storage-state.json"
);
const OUT_ROOT = path.join(
  process.cwd(),
  "data",
  "reverse-engineering",
  new Date().toISOString().slice(0, 10)
);

// ─── Args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = { stores: null, headless: false };
  for (let i = 2; i < process.argv.length; i++) {
    const cur = process.argv[i];
    if (cur === "--stores" && process.argv[i + 1]) {
      args.stores = process.argv[++i].split(",").map((s) => s.trim());
    } else if (cur.startsWith("--stores=")) {
      args.stores = cur.slice(9).split(",").map((s) => s.trim());
    } else if (cur === "--headed") args.headless = false;
    else if (cur === "--headless") args.headless = true;
  }
  return args;
}

// ─── Helpers ───────────────────────────────────────────────────────────
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8"); }
function log(msg) { console.log(`[deep-re] ${msg}`); }

function buildUrl(store, tabId) {
  const u = new URL(BASE_URL);
  u.searchParams.set("search", "");
  u.searchParams.set("limit", "50");
  u.searchParams.set("offset", "0");
  u.searchParams.set("selectedTab", tabId);
  u.searchParams.set("store", store);
  u.searchParams.set("filters", tabId);
  u.searchParams.set("subFilters", "");
  u.searchParams.set("startPeriod", "");
  return u.toString();
}

// ─── Brick tree walker ────────────────────────────────────────────────
function findAllByUiType(node, uiType, acc = []) {
  if (!node) return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAllByUiType(n, uiType, acc)); return acc; }
  if (typeof node !== "object") return acc;
  if (node.uiType === uiType) acc.push(node);
  for (const k of Object.keys(node)) findAllByUiType(node[k], uiType, acc);
  return acc;
}

function extractBricksData(allEventRequests) {
  // Merge todos os payloads em uma estrutura unica (podem vir em updates
  // separados: update_complete_bricks, update_bricks)
  const mergedBody = { bricks_bodies: allEventRequests.map((x) => x.body) };

  const cards = findAllByUiType(mergedBody, "dashboard_operations_card")
    .filter((c) => !c.id?.startsWith("card_placeholder"))
    .map((c) => {
      const tasks = findAllByUiType(c, "dashboard_operations_task").map((t) => ({
        id: t.id,
        task_key: t.id?.split("-")[0] || null,
        label: t.data?.label || t.data?.text || null,
        quantity: t.data?.quantity ?? t.data?.count ?? null,
      }));
      return {
        id: c.id,
        tag: c.data?.tag || null,
        label: c.data?.label || c.data?.title || null,
        count: c.data?.salesQuantity ?? c.data?.count ?? c.data?.quantity ?? null,
        tasks,
      };
    });

  const segmentedActions = findAllByUiType(mergedBody, "segmented_actions")
    .flatMap((s) => s.data?.segments || [])
    .reduce((acc, s) => {
      if (!acc.find((x) => x.id === s.id)) {
        acc.push({ id: s.id, text: s.text, count: s.count, priority: s.priority });
      }
      return acc;
    }, []);

  const filterDates = findAllByUiType(mergedBody, "filter_dates")
    .map((f) => ({
      id: f.id,
      data: f.data || null,
      bricks_count: Array.isArray(f.bricks) ? f.bricks.length : 0,
    }));

  const actionButtons = findAllByUiType(mergedBody, "action_button_tooltip")
    .map((b) => ({
      id: b.id,
      text: b.data?.text || null,
      count: b.data?.count ?? null,
      url: b.data?.url || null,
      hierarchy: b.data?.hierarchy || null,
    }));

  return { cards, segmented_actions: segmentedActions, filter_dates: filterDates, action_buttons: actionButtons };
}

// ─── DOM extraction (pra complementar) ────────────────────────────────
async function extractDom(page) {
  return page.evaluate(() => {
    const t = (el) => el?.textContent?.trim().replace(/\s+/g, " ") || "";
    const buttons = [];
    document.querySelectorAll("button, [role=button], a.andes-button").forEach((b) => {
      const label = t(b);
      if (!label || label.length > 120) return;
      buttons.push({
        label,
        disabled: b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true",
        data_testid: b.getAttribute("data-testid") || null,
      });
    });
    return {
      url: location.href,
      title: document.title,
      header_title: t(document.querySelector("h1, h2")),
      buttons_count: buttons.length,
      buttons_sample: buttons.slice(0, 40),
      capture_ts: new Date().toISOString(),
    };
  });
}

// ─── Open dropdowns to capture options ────────────────────────────────
async function captureDropdownOptions(page) {
  const out = {};
  try {
    // Dropdown de datas — clica no trigger "Últimos 2 meses" (ou texto similar)
    const dateTrigger = await page.$(
      'button:has-text("Últimos"), [data-testid*=filter-dates] button, [data-testid*=date] button'
    );
    if (dateTrigger) {
      await dateTrigger.click({ timeout: 3000 });
      await page.waitForTimeout(800);
      const opts = await page.evaluate(() => {
        const items = [
          ...document.querySelectorAll(
            ".andes-floating-menu li, .andes-list__item, [role=option], [role=menuitem]"
          ),
        ];
        return items.map((el) => el.textContent?.trim().replace(/\s+/g, " ") || "");
      });
      out.date_options = opts.filter(Boolean);
      await page.keyboard.press("Escape").catch(() => {});
    }
  } catch (err) {
    out.date_error = String(err);
  }
  return out;
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    console.error(`[deep-re] Sem storage state em ${STORAGE_STATE_PATH}`);
    console.error("Rode: node scripts/refresh-ml-session.mjs");
    process.exit(1);
  }

  const selected = args.stores
    ? STORE_VIEWS.filter((v) => args.stores.includes(v.key))
    : STORE_VIEWS;
  if (!selected.length) { console.error("Store inválido"); process.exit(1); }

  ensureDir(OUT_ROOT);
  log(`Storage: ${STORAGE_STATE_PATH}`);
  log(`Out: ${OUT_ROOT}`);
  log(`Capturas: ${selected.length} × ${TABS.length} = ${selected.length * TABS.length}`);

  const browser = await chromium.launch({ headless: args.headless });

  const summary = [];
  try {
    for (const view of selected) {
      // FRESH CONTEXT por store — evita que SPA routing do ML preserve state
      // do store anterior e omita XHRs de bricks.
      const context = await browser.newContext({
        storageState: STORAGE_STATE_PATH,
        viewport: { width: 1440, height: 900 },
        locale: "pt-BR",
      });
      const page = await context.newPage();

      // Listener registrado ANTES de qualquer goto
      let xhrBuffer = [];
      page.on("response", async (response) => {
        const u = response.url();
        if (!u.includes("channels/event-request") && !u.includes("/operations-dashboard")) return;
        try {
          const body = await response.json().catch(() => null);
          xhrBuffer.push({
            url: u,
            method: response.request().method(),
            status: response.status(),
            body,
            captured_at: new Date().toISOString(),
          });
        } catch {}
      });

      for (const tab of TABS) {
        const outDir = path.join(OUT_ROOT, view.key, tab.key);
        ensureDir(outDir);
        const url = buildUrl(view.store, tab.id);
        log(`→ ${view.key} / ${tab.key}`);

        xhrBuffer = []; // reset por captura

        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          try {
            await page.waitForSelector(
              "text=/Envios de hoje|Pr.ximos dias|Em tr.nsito|Finalizadas/i",
              { timeout: 30000 }
            );
          } catch {}
          await page.waitForTimeout(5000);

          const eventRequests = xhrBuffer.filter((x) => x.url.includes("channels/event-request"));
          const bricks = extractBricksData(eventRequests);
          writeJson(path.join(outDir, "bricks.json"), bricks);

          const dom = await extractDom(page);
          const dropdowns = await captureDropdownOptions(page);
          writeJson(path.join(outDir, "dom.json"), { ...dom, dropdowns });

          writeJson(path.join(outDir, "xhrs.json"), xhrBuffer);

          await page.screenshot({ path: path.join(outDir, "screenshot.png"), fullPage: true });

          writeJson(path.join(outDir, "meta.json"), {
            store: view, tab, url,
            captured_at: new Date().toISOString(),
            stats: {
              event_requests: eventRequests.length,
              cards: bricks.cards.length,
              tasks_total: bricks.cards.reduce((s, c) => s + c.tasks.length, 0),
              segmented_actions: bricks.segmented_actions.length,
              action_buttons: bricks.action_buttons.length,
            },
          });

          summary.push({
            store: view.key,
            tab: tab.key,
            cards: bricks.cards.length,
            tasks: bricks.cards.reduce((s, c) => s + c.tasks.length, 0),
            tabs_counts: bricks.segmented_actions.map((s) => `${s.id}=${s.count}`).join(","),
            ok: true,
          });

          log(
            `  ✓ cards=${bricks.cards.length} tasks=${bricks.cards.reduce((s, c) => s + c.tasks.length, 0)} chips=${bricks.segmented_actions.length} xhrs=${xhrBuffer.length}`
          );
        } catch (err) {
          summary.push({ store: view.key, tab: tab.key, ok: false, error: String(err) });
          log(`  ✗ ERRO: ${err.message}`);
          writeJson(path.join(outDir, "error.json"), { error: String(err), stack: err?.stack });
        }
      }
      // Fecha contexto deste store antes de abrir o próximo
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // summary.md
  const md = [
    `# Deep Reverse Engineer ML — ${new Date().toISOString().slice(0, 10)}`,
    "",
    "| Depósito | Tab | Cards | Tasks | Chips | Status |",
    "|---|---|---:|---:|---|:---:|",
    ...summary.map((s) =>
      `| ${s.store} | ${s.tab} | ${s.cards || 0} | ${s.tasks || 0} | ${s.tabs_counts || "?"} | ${s.ok ? "✓" : "✗"} |`
    ),
    "",
    `Ver detalhes em: \`${OUT_ROOT}/<store>/<tab>/bricks.json\``,
  ].join("\n");
  fs.writeFileSync(path.join(OUT_ROOT, "summary.md"), md, "utf-8");
  log(`Concluído. ${path.join(OUT_ROOT, "summary.md")}`);
}

main().catch((err) => { console.error("[deep-re] FATAL", err); process.exit(1); });
