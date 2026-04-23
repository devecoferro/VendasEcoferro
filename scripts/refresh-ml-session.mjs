// ─── Renova sessão ML (storage state do Playwright) ──────────────────
//
// Abre browser HEADED. Você loga manualmente.
// Script detecta login automaticamente (cookie SELLER_CENTER ou URL da
// lista de vendas) e salva o storage state sem precisar ENTER.
//
// Uso:
//   node scripts/refresh-ml-session.mjs
//
// Saída: data/playwright/private-seller-center.storage-state.json

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.join(
  process.cwd(),
  "data",
  "playwright",
  "private-seller-center.storage-state.json"
);

const SUCCESS_URL_PATTERN = /mercadolivre\.com\.br\/vendas\/omni/i;
const LOGIN_WAIT_MS = 15 * 60 * 1000; // 15 min pra você logar com calma

async function waitForLoginSuccess(page) {
  const start = Date.now();
  console.log("[refresh-session] Aguardando login… (timeout 15min)");
  while (Date.now() - start < LOGIN_WAIT_MS) {
    try {
      const url = page.url();
      if (SUCCESS_URL_PATTERN.test(url)) {
        // Confirma que tem conteúdo da lista (não tela de erro)
        const hasError = await page.$('text=/Hubo un error|Ocorreu um erro/i').catch(() => null);
        if (!hasError) {
          // Confirma que chips apareceram
          const hasChips = await page
            .$('text=/Envios de hoje|Pr.ximos dias/i')
            .catch(() => null);
          if (hasChips) {
            console.log(
              `[refresh-session] Login detectado em ${Math.round((Date.now() - start) / 1000)}s: ${url}`
            );
            return true;
          }
        }
      }
    } catch {
      // Page pode estar navegando, ignora
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  console.log("[refresh-session] Abrindo browser…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
  });
  const page = await context.newPage();

  console.log("[refresh-session] Navegando pro ML Seller Center…");
  await page.goto(
    "https://www.mercadolivre.com.br/vendas/omni/lista?selectedTab=TAB_TODAY",
    { waitUntil: "domcontentloaded" }
  );

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  👉 LOGA NA CONTA ECOFERRO NO BROWSER QUE ABRIU             ║");
  console.log("║  Script detecta sucesso automaticamente e fecha o browser.   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  const ok = await waitForLoginSuccess(page);
  if (!ok) {
    console.error(
      "[refresh-session] TIMEOUT — login não detectado em 15 min. Abortando."
    );
    await browser.close();
    process.exit(1);
  }

  // Pequena espera pra cookies assentarem
  await page.waitForTimeout(2000);

  await context.storageState({ path: OUT });
  const stat = fs.statSync(OUT);
  console.log("");
  console.log("[refresh-session] ✓ Storage state salvo em:");
  console.log("  " + OUT);
  console.log("  Tamanho: " + stat.size + " bytes");
  console.log("  Timestamp: " + stat.mtime.toISOString());
  console.log("");
  console.log("[refresh-session] Pronto. Pode fechar o browser e rodar:");
  console.log("  node scripts/deep-reverse-engineer-ml.mjs");

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[refresh-session] FATAL", err);
  process.exit(1);
});
