#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Setup inicial do scraper do ML Seller Center
//
// USO: npm run setup:ml-scraper
//
// Esse script abre um Chromium VISÍVEL no seu computador.
// Você faz login no Mercado Livre (com MFA se houver).
// Quando terminar, o cookie/sessão é salvo em:
//   $DATA_DIR/playwright/ml-seller-center-state.json
//
// Esse arquivo DEVE ser copiado para a VPS (Coolify) e posto no volume
// persistente do container, no mesmo caminho.
//
// Depois disso, o scraper roda headless a cada 5min e atualiza os chips.
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, "data");

const STATE_PATH = path.join(DATA_DIR, "playwright", "ml-seller-center-state.json");
const ML_BASE = "https://www.mercadolivre.com.br/vendas/omni/lista";

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SETUP — Scraper do ML Seller Center");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Storage state será salvo em:\n  ${STATE_PATH}\n`);

  // Cria diretório se não existe
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  let chromium;
  try {
    const mod = await import("playwright");
    chromium = mod.chromium;
  } catch {
    console.error(
      "\n❌ Playwright não instalado. Execute:\n   npm install playwright && npx playwright install chromium\n"
    );
    process.exit(1);
  }

  console.log("Abrindo Chromium visível…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();

  console.log(`Navegando para ${ML_BASE}…`);
  await page.goto(ML_BASE);

  console.log("\n───────────────────────────────────────────────────────");
  console.log("  PRÓXIMOS PASSOS (NO BROWSER ABERTO):");
  console.log("───────────────────────────────────────────────────────");
  console.log("  1. Faça login no Mercado Livre com a conta ECOFERRO");
  console.log("  2. Complete MFA se pedir (aprovação via celular)");
  console.log("  3. Aguarde carregar a tela de Vendas");
  console.log("  4. Quando ver os chips (Envios hoje, etc.),");
  console.log("     VOLTE AQUI NO TERMINAL e pressione ENTER");
  console.log("───────────────────────────────────────────────────────\n");

  // Espera user pressionar Enter
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  await new Promise((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  console.log("Salvando storage state…");
  await context.storageState({ path: STATE_PATH });

  console.log(`\n✅ Storage state salvo em:\n   ${STATE_PATH}\n`);
  console.log("PRÓXIMOS PASSOS:");
  console.log("  - Copie esse arquivo para a VPS (mesmo caminho no DATA_DIR)");
  console.log("  - Exemplo via SSH:");
  console.log(
    `    scp ${STATE_PATH} root@77.37.69.102:/data/vendas-ecoferro-vps/data/playwright/\n`
  );
  console.log(
    "  - Após isso, o scraper começa a rodar automaticamente em ~5min\n"
  );

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Setup falhou:", err);
  process.exit(1);
});
