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

// Brief 2026-04-28 multi-seller: aceita --connection=<id> pra capturar
// storage state per-seller (EcoFerro, Fantom, etc).
const argv = process.argv.slice(2);
const connArg = argv.find((a) => a.startsWith("--connection="));
const connectionId = connArg ? connArg.split("=", 2)[1] : null;

const STATE_FILENAME = connectionId
  ? `ml-seller-center-state-${connectionId}.json`
  : "ml-seller-center-state.json";
const STATE_PATH = path.join(DATA_DIR, "playwright", STATE_FILENAME);
const ML_BASE = "https://www.mercadolivre.com.br/vendas/omni/lista";

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SETUP — Scraper do ML Seller Center");
  console.log("═══════════════════════════════════════════════════════");
  if (connectionId) {
    console.log(`  Connection ID: ${connectionId}`);
  } else {
    console.log(`  (sem --connection — salvando como state DEFAULT/EcoFerro)`);
  }
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

  const accountLabel = connectionId
    ? `a conta vinculada à connection ${connectionId} (Fantom Motoparts ou similar)`
    : "a conta ECOFERRO";
  console.log("\n───────────────────────────────────────────────────────");
  console.log("  PRÓXIMOS PASSOS (NO BROWSER ABERTO):");
  console.log("───────────────────────────────────────────────────────");
  console.log(`  1. Faça login no Mercado Livre com ${accountLabel}`);
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
  console.log("  - Copie esse arquivo para a VPS no mesmo caminho.");
  console.log("  - Exemplo via SSH (ajuste se DATA_DIR for diferente):");
  console.log(
    `    scp ${STATE_PATH} root@77.37.69.102:/tmp/ && \\`
  );
  console.log(
    `    ssh root@77.37.69.102 "docker cp /tmp/${STATE_FILENAME} \\$(docker ps -q -f name=m1b5cfm30arif8y7bia20bwo):/app/data/playwright/${STATE_FILENAME}"\n`
  );
  console.log("  - Após isso, o scraper começa a rodar automaticamente.");
  if (connectionId) {
    console.log(`  - O endpoint /api/ml/live-snapshot?connection_id=${connectionId} vai usar este state.`);
  }
  console.log();

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Setup falhou:", err);
  process.exit(1);
});
