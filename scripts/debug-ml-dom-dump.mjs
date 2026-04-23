// Debug: dumpa HTML bruto e lista de XHRs do ML Seller Center pra
// inspeção manual. Usado pra descobrir selectors reais dos cards/cards/
// dropdowns e endpoints.
//
// Saída: data/reverse-engineering/debug/<tab>.{html,xhrs.json,screenshot.png}

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const STORAGE = path.join(
  process.cwd(),
  "data",
  "playwright",
  "private-seller-center.storage-state.json"
);
const OUT = path.join(process.cwd(), "data", "reverse-engineering", "debug");
fs.mkdirSync(OUT, { recursive: true });

const TABS = [
  { key: "today", id: "TAB_TODAY" },
  { key: "next_days", id: "TAB_NEXT_DAYS" },
];

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: STORAGE,
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
  });

  const page = await context.newPage();

  // Register XHR listener BEFORE any navigation
  const xhrs = [];
  page.on("response", async (response) => {
    const u = response.url();
    // Captura TUDO que não é asset/img/css
    if (/\.(png|jpg|jpeg|svg|css|woff|ico|gif)(\?|$)/i.test(u)) return;
    if (!u.includes("mercadolivre.com.br") && !u.includes("mercadolibre.com"))
      return;
    try {
      const ct = response.headers()["content-type"] || "";
      const isJson = ct.includes("json");
      let body = null;
      if (isJson) {
        try {
          body = await response.json();
        } catch {
          body = await response.text();
        }
      }
      const isEventRequest = u.includes("channels/event-request");
      xhrs.push({
        url: u,
        method: response.request().method(),
        status: response.status(),
        content_type: ct,
        body_size:
          typeof body === "string"
            ? body.length
            : body
              ? JSON.stringify(body).length
              : 0,
        // Para event-request salva body COMPLETO (onde estão os bricks/cards).
        // Pra outros XHRs só preview pra evitar arquivo gigante.
        body: isEventRequest ? body : null,
        body_preview: body
          ? typeof body === "string"
            ? body.slice(0, 500)
            : JSON.stringify(body).slice(0, 2000)
          : null,
      });
    } catch (err) {
      xhrs.push({ url: u, error: String(err) });
    }
  });

  for (const tab of TABS) {
    const xhrsBefore = xhrs.length;
    console.log(`[debug] ${tab.key} — navegando…`);

    await page.goto(
      `https://www.mercadolivre.com.br/vendas/omni/lista?search=&limit=50&offset=0&selectedTab=${tab.id}&store=79856028&filters=${tab.id}&subFilters=&startPeriod=`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    try {
      await page.waitForSelector(
        'text=/Envios de hoje|Pr.ximos dias|Em tr.nsito|Finalizadas/i',
        { timeout: 30000 }
      );
    } catch {}

    await page.waitForTimeout(6000);

    // Dump HTML da área principal — mira o <main> ou body inteiro
    const mainHtml = await page.evaluate(() => {
      const main =
        document.querySelector("main") ||
        document.querySelector("[role=main]") ||
        document.querySelector("#root") ||
        document.body;
      return main ? main.outerHTML : document.documentElement.outerHTML;
    });
    fs.writeFileSync(
      path.join(OUT, `${tab.key}.html`),
      mainHtml,
      "utf-8"
    );

    // Screenshot
    await page.screenshot({
      path: path.join(OUT, `${tab.key}.screenshot.png`),
      fullPage: true,
    });

    // Tenta clicar em um dropdown pra ver opções
    try {
      const datePicker = await page.$('text="Últimos 2 meses"');
      if (datePicker) {
        await datePicker.click();
        await page.waitForTimeout(1500);
        const dropdownHtml = await page.evaluate(() => {
          const opened = document.querySelector(
            ".andes-floating-menu, .andes-dropdown__popper, [class*=dropdown][class*=open], [role=listbox]"
          );
          return opened ? opened.outerHTML : null;
        });
        if (dropdownHtml) {
          fs.writeFileSync(
            path.join(OUT, `${tab.key}.date_dropdown.html`),
            dropdownHtml,
            "utf-8"
          );
        }
        // Fecha
        await page.keyboard.press("Escape");
      }
    } catch (err) {
      console.log(`  dropdown click falhou: ${err.message}`);
    }

    const newXhrs = xhrs.slice(xhrsBefore);
    console.log(`  ${newXhrs.length} XHRs capturados`);
  }

  fs.writeFileSync(
    path.join(OUT, "xhrs.json"),
    JSON.stringify(xhrs, null, 2),
    "utf-8"
  );

  console.log(`[debug] Terminou. Arquivos em: ${OUT}`);
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
