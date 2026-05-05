#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// CAPTURAR COOKIES DO ML SELLER CENTER
//
// Este script captura os cookies de sessão do Mercado Livre e salva
// em um arquivo JSON que deve ser enviado para o servidor via a página
// de admin do VendasEcoferro.
//
// ─── USO ─────────────────────────────────────────────────────────
//
//   Para a conta FANTOM (default):
//     node capturar-cookies-ml.mjs
//
//   Para a conta ECOFERRO:
//     node capturar-cookies-ml.mjs --connection=ecoferro
//
//   Para a conta FANTOM explicitamente:
//     node capturar-cookies-ml.mjs --connection=fantom
//
// ─── REQUISITOS ──────────────────────────────────────────────────
//
//   1. Node.js 18+ instalado
//   2. Instalar dependências:
//        npm init -y
//        npm install playwright
//        npx playwright install chromium
//
// ─── APÓS RODAR ──────────────────────────────────────────────────
//
//   1. O arquivo será salvo na mesma pasta do script
//   2. Acesse: https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state
//   3. Faça upload do arquivo gerado
//   4. Os chips do ML vão atualizar em até 2 minutos
//
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuração ───────────────────────────────────────────────
const ML_URL = "https://www.mercadolivre.com.br/vendas/omni/lista";

// Aceita --connection=<id> para multi-conta
const argv = process.argv.slice(2);
const connArg = argv.find((a) => a.startsWith("--connection="));
const connectionId = connArg ? connArg.split("=", 2)[1] : null;

// Nome do arquivo de saída
const OUTPUT_FILENAME = connectionId
  ? `ml-seller-center-state-${connectionId}.json`
  : "ml-seller-center-state.json";
const OUTPUT_PATH = path.join(__dirname, OUTPUT_FILENAME);

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log();
  console.log("═══════════════════════════════════════════════════════");
  console.log("  CAPTURAR COOKIES DO ML SELLER CENTER");
  console.log("═══════════════════════════════════════════════════════");
  console.log();
  if (connectionId) {
    console.log(`  Conta alvo: ${connectionId.toUpperCase()}`);
  } else {
    console.log(`  Conta alvo: DEFAULT (sem connection_id)`);
  }
  console.log(`  Arquivo de saída: ${OUTPUT_PATH}`);
  console.log();

  // Importar Playwright
  let chromium;
  try {
    const mod = await import("playwright");
    chromium = mod.chromium;
  } catch {
    console.error(
      "╔══════════════════════════════════════════════════════╗\n" +
      "║  ❌ Playwright não instalado!                       ║\n" +
      "║                                                      ║\n" +
      "║  Execute estes comandos na pasta deste script:       ║\n" +
      "║                                                      ║\n" +
      "║    npm init -y                                       ║\n" +
      "║    npm install playwright                            ║\n" +
      "║    npx playwright install chromium                   ║\n" +
      "║                                                      ║\n" +
      "╚══════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }

  // Abrir browser visível
  console.log("  Abrindo Chromium...\n");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();

  console.log(`  Navegando para: ${ML_URL}\n`);
  await page.goto(ML_URL, { waitUntil: "domcontentloaded" });

  const accountLabel = connectionId
    ? connectionId.toUpperCase()
    : "a conta desejada";

  console.log("┌──────────────────────────────────────────────────────┐");
  console.log("│  INSTRUÇÕES:                                         │");
  console.log("├──────────────────────────────────────────────────────┤");
  console.log(`│  1. Faça login com ${accountLabel.padEnd(30)}│`);
  console.log("│  2. Complete MFA se pedir (celular)                  │");
  console.log("│  3. Aguarde a tela de VENDAS carregar                │");
  console.log("│     (deve mostrar: Envios hoje, Próximos dias, etc.) │");
  console.log("│  4. Volte aqui e pressione ENTER                     │");
  console.log("└──────────────────────────────────────────────────────┘");
  console.log();

  // Espera user pressionar Enter
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  await new Promise((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Captura storage state
  console.log("  Capturando cookies...");
  await context.storageState({ path: OUTPUT_PATH });
  
  const stateContent = fs.readFileSync(OUTPUT_PATH, "utf8");
  const stateJson = JSON.parse(stateContent);
  const numCookies = stateJson.cookies?.length || 0;

  console.log(`  ✅ ${numCookies} cookies capturados`);
  console.log(`  ✅ Arquivo salvo: ${OUTPUT_PATH}`);
  console.log(`  ✅ Tamanho: ${(stateContent.length / 1024).toFixed(1)} KB`);

  // Mostrar cookies-chave
  const cookieNames = (stateJson.cookies || []).map((c) => c.name);
  const keyNames = ["D_SID", "_d2id", "_csrf", "orguseridp", "ml-uid", "_ml_ci"];
  const foundKeys = keyNames.filter((n) => cookieNames.includes(n));
  if (foundKeys.length > 0) {
    console.log(`  ✅ Cookies de sessão: ${foundKeys.join(", ")}`);
  }

  await browser.close();

  // Instruções finais
  console.log();
  console.log("═══════════════════════════════════════════════════════");
  console.log("  PRÓXIMO PASSO — UPLOAD PARA O SERVIDOR");
  console.log("═══════════════════════════════════════════════════════");
  console.log();
  console.log("  1. Abra no browser:");
  console.log("     https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state");
  if (connectionId) {
    console.log(`     (adicione ?connection_id=${connectionId} na URL)`);
    console.log(`     URL completa:`);
    console.log(`     https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state?connection_id=${connectionId}`);
  }
  console.log();
  console.log("  2. Selecione o arquivo:");
  console.log(`     ${OUTPUT_PATH}`);
  console.log();
  console.log("  3. Clique em 'Fazer upload'");
  console.log();
  console.log("  4. Pronto! Os chips vão atualizar em até 2 minutos.");
  console.log();
  console.log("═══════════════════════════════════════════════════════");
  console.log();

  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message || err);
  process.exit(1);
});
