#!/usr/bin/env node
/**
 * Auditoria de marcas e modelos do estoque sincronizado.
 *
 * Roda direto contra o banco SQLite (mesmo de produção quando executado
 * dentro do container Coolify) e gera um relatorio em texto que mostra:
 *
 *   1. Marcas conhecidas detectadas + contagem por marca
 *   2. Produtos SEM marca identificada (com sugestoes do que pode estar
 *      faltando em KNOWN_BRANDS)
 *   3. Marcas raw do ML que NAO estao em KNOWN_BRANDS (candidatas a
 *      adicionar — sao palavras unicas e curtas que aparecem no campo
 *      brand mas nunca foram catalogadas)
 *   4. Modelos detectados por marca + modelos NAO detectados (titulos
 *      onde a marca foi encontrada mas nenhum modelo de KNOWN_MODELS
 *      bateu — sugestoes de modelos novos)
 *   5. SKUs duplicados (mesmo SKU em multiplos item_id — indica erro
 *      de cadastro no ML)
 *   6. Produtos com problemas: sem SKU, sem titulo, sem brand
 *
 * Uso:
 *   node scripts/audit-stock-brands.mjs                  (relatorio completo)
 *   node scripts/audit-stock-brands.mjs --suggestions    (so sugestoes acionaveis)
 *   node scripts/audit-stock-brands.mjs --no-brand       (so produtos sem brand)
 *   node scripts/audit-stock-brands.mjs --json           (saida JSON pra script)
 *
 * No Coolify: Terminal -> npm run audit-brands
 */

import path from "node:path";
import fs from "node:fs";
import process from "node:process";
import Database from "better-sqlite3";

// Mantem lista sincronizada com api/ml/stock.js. Se adicionar marca la,
// adiciona aqui tambem (ou refatorar pra import compartilhado depois).
const KNOWN_BRANDS = [
  "Mottu",
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Ducati", "Triumph",
  "Harley-Davidson", "KTM", "Husqvarna", "Royal Enfield", "Kasinski",
  "Benelli", "MV Agusta", "Aprilia", "Dafra", "Shineray",
];
const OWN_BRANDS = ["Ecoferro", "Fantom"];

// Palavras-chave que parecem ser marca de moto mas nao estao em KNOWN_BRANDS.
// Se aparecerem nos titulos com frequencia, devem ser candidatas pra adicionar.
const POTENTIAL_BRAND_KEYWORDS = [
  "Bajaj", "Voge", "Sym", "Kymco", "Piaggio", "Vespa", "GreenSport",
  "Garinni", "Haojue", "Lifan", "Loncin", "Sundown", "Avelloz",
  "Brava", "Mahindra", "Hero", "TVS", "Bull", "Pop100",
  "CFMoto", "GTR", "Buell",
  // Marcas eletricas / scooter
  "Niu", "Voltz", "Watts",
  // Brand types
  "Custom", "Cafe Racer",
];

function resolveDbPath() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "app.db");
}

function loadAllStock(db) {
  return db
    .prepare(
      `SELECT item_id, sku, title, brand, model, vehicle_year, status,
              available_quantity, sold_quantity
       FROM ml_stock`
    )
    .all();
}

function normalizeForCompare(text) {
  return String(text || "").toLowerCase().trim();
}

function tokenize(text) {
  return String(text || "")
    .replace(/[^\w\s\u00C0-\u00FF-]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function isBrandKnown(brand) {
  if (!brand) return false;
  const normalized = normalizeForCompare(brand);
  return [...KNOWN_BRANDS, ...OWN_BRANDS, "Universal"].some(
    (b) => normalizeForCompare(b) === normalized
  );
}

function findPotentialBrandsInTitles(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.brand) continue; // ja tem marca normalizada
    const text = normalizeForCompare(item.title);
    if (!text) continue;
    for (const keyword of POTENTIAL_BRAND_KEYWORDS) {
      if (text.includes(normalizeForCompare(keyword))) {
        counts.set(keyword, (counts.get(keyword) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function findUnknownRawBrands(items) {
  // Marcas raw que vieram do ML mas nao foram normalizadas (brand=null)
  // ou que parecem ser unicas/curtas (provavel marca real ainda nao catalogada)
  const counts = new Map();
  for (const item of items) {
    if (item.brand && isBrandKnown(item.brand)) continue;
    if (!item.brand) continue;
    const key = item.brand.trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([brand]) => brand.length < 30 && !/\d{4}/.test(brand))
    .sort((a, b) => b[1] - a[1]);
}

function findMissingModels(items) {
  // Por brand conhecida, tenta extrair modelos potenciais dos titulos onde
  // o `model` saiu null. Sugere palavras-chave + numero (CB300, MT09 etc).
  const byBrand = new Map();
  for (const item of items) {
    if (!item.brand || !isBrandKnown(item.brand)) continue;
    if (item.model) continue; // ja tem modelo identificado
    const tokens = tokenize(item.title);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      // Pattern: 2-4 letras + numero (CB300, MT09, R1, R3, FZ25)
      if (/^[A-Za-z]{1,4}\d{1,4}$/.test(token)) {
        const key = `${item.brand}:${token.toUpperCase()}`;
        byBrand.set(key, (byBrand.get(key) || 0) + 1);
      }
    }
  }
  return [...byBrand.entries()]
    .map(([key, count]) => {
      const [brand, model] = key.split(":");
      return { brand, model, count };
    })
    .sort((a, b) => b.count - a.count);
}

function findDuplicateSkus(items) {
  const bySku = new Map();
  for (const item of items) {
    if (!item.sku) continue;
    const key = item.sku.trim().toUpperCase();
    if (!bySku.has(key)) bySku.set(key, []);
    bySku.get(key).push(item);
  }
  return [...bySku.entries()].filter(([, list]) => list.length > 1);
}

function pad(value, width) {
  return String(value).padEnd(width).slice(0, width);
}

function printSection(title) {
  console.log("");
  console.log("─".repeat(70));
  console.log(` ${title}`);
  console.log("─".repeat(70));
}

function main() {
  const args = process.argv.slice(2);
  const onlyJson = args.includes("--json");
  const onlySuggestions = args.includes("--suggestions");
  const onlyNoBrand = args.includes("--no-brand");

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[erro] Banco nao encontrado: ${dbPath}`);
    console.error(`       Defina DATA_DIR=/caminho/data se necessario.`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const items = loadAllStock(db);

  if (items.length === 0) {
    console.log("[info] Nenhum produto no estoque local. Sincronize primeiro.");
    db.close();
    process.exit(0);
  }

  // ── Computacoes ──
  const brandCounts = new Map();
  const noBrandItems = [];
  const noModelByBrand = new Map();
  const noSkuItems = [];

  for (const item of items) {
    const brandLabel = item.brand || "(sem marca)";
    brandCounts.set(brandLabel, (brandCounts.get(brandLabel) || 0) + 1);

    if (!item.brand) noBrandItems.push(item);
    else if (!item.model) {
      if (!noModelByBrand.has(item.brand)) noModelByBrand.set(item.brand, []);
      noModelByBrand.get(item.brand).push(item);
    }

    if (!item.sku || item.sku.trim() === "") noSkuItems.push(item);
  }

  const sortedBrandCounts = [...brandCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  );
  const potentialBrands = findPotentialBrandsInTitles(items);
  const unknownRawBrands = findUnknownRawBrands(items);
  const missingModels = findMissingModels(items);
  const duplicateSkus = findDuplicateSkus(items);

  if (onlyJson) {
    const report = {
      total_items: items.length,
      brand_counts: Object.fromEntries(sortedBrandCounts),
      no_brand_count: noBrandItems.length,
      no_brand_sample: noBrandItems.slice(0, 30).map((i) => ({
        item_id: i.item_id,
        title: i.title,
        sku: i.sku,
      })),
      potential_brand_keywords: potentialBrands.map(([brand, count]) => ({
        brand,
        count,
      })),
      unknown_raw_brands: unknownRawBrands.map(([brand, count]) => ({
        brand,
        count,
      })),
      missing_models: missingModels.slice(0, 50),
      duplicate_skus: duplicateSkus.map(([sku, list]) => ({
        sku,
        count: list.length,
        items: list.map((i) => ({ item_id: i.item_id, title: i.title })),
      })),
      no_sku_count: noSkuItems.length,
    };
    console.log(JSON.stringify(report, null, 2));
    db.close();
    return;
  }

  // ── Modo so produtos sem brand ──
  if (onlyNoBrand) {
    console.log(
      `\n${noBrandItems.length} produto(s) SEM marca identificada (de ${items.length} totais)\n`
    );
    for (const item of noBrandItems) {
      console.log(
        `  ${pad(item.item_id, 16)} ${pad(item.sku || "—", 10)} ${item.title || "(sem titulo)"}`
      );
    }
    db.close();
    return;
  }

  // ── Relatorio completo (default) ──

  console.log(`\n📊 AUDITORIA DE ESTOQUE — ${items.length} produtos`);
  console.log(`Banco: ${dbPath}`);
  console.log(`Gerado em ${new Date().toLocaleString("pt-BR")}`);

  if (!onlySuggestions) {
    printSection("1️⃣  MARCAS DETECTADAS (ordenado por contagem)");
    for (const [brand, count] of sortedBrandCounts) {
      const isKnown = brand !== "(sem marca)" && isBrandKnown(brand);
      const tag = isKnown ? "✓" : brand === "(sem marca)" ? "✗" : "?";
      const pct = ((count / items.length) * 100).toFixed(1);
      console.log(`  ${tag} ${pad(brand, 28)} ${pad(count, 6)} (${pct}%)`);
    }
    console.log(`\n  Legenda: ✓=conhecida  ?=raw do ML nao normalizada  ✗=sem brand`);
  }

  printSection("2️⃣  SUGESTOES DE MARCAS PRA ADICIONAR EM KNOWN_BRANDS");
  if (unknownRawBrands.length === 0) {
    console.log("  (nenhuma — todas as marcas raw do ML ja estao normalizadas)");
  } else {
    console.log(
      "  Marcas que vieram do campo brand do ML mas nao bateram com KNOWN_BRANDS."
    );
    console.log("  Se forem marcas reais, adicione em api/ml/stock.js:KNOWN_BRANDS\n");
    for (const [brand, count] of unknownRawBrands.slice(0, 20)) {
      console.log(`  • ${pad(brand, 28)} ${count} produto(s)`);
    }
  }

  printSection("3️⃣  MARCAS POTENCIAIS DETECTADAS NOS TITULOS (sem brand setada)");
  if (potentialBrands.length === 0) {
    console.log("  (nenhuma — produtos sem brand nao mencionam marcas conhecidas no titulo)");
  } else {
    console.log("  Palavras-chave de marcas conhecidas que aparecem em titulos");
    console.log("  de produtos SEM brand identificada — candidatas a adicionar:\n");
    for (const [brand, count] of potentialBrands) {
      console.log(`  • ${pad(brand, 28)} ${count} produto(s) com essa palavra no titulo`);
    }
  }

  printSection("4️⃣  MODELOS POTENCIAIS NAO DETECTADOS");
  if (missingModels.length === 0) {
    console.log("  (nenhum — KNOWN_MODELS cobre bem)");
  } else {
    console.log("  Padroes tipo 'CB300', 'MT09' etc encontrados em titulos onde");
    console.log("  KNOWN_MODELS[brand] nao bateu. Top 30:\n");
    for (const { brand, model, count } of missingModels.slice(0, 30)) {
      console.log(`  • ${pad(brand, 14)} ${pad(model, 12)} ${count} produto(s)`);
    }
  }

  if (!onlySuggestions) {
    printSection("5️⃣  SKUs DUPLICADOS (mesmo SKU em multiplos item_id)");
    if (duplicateSkus.length === 0) {
      console.log("  (nenhum — todos os SKUs sao unicos no estoque)");
    } else {
      for (const [sku, list] of duplicateSkus.slice(0, 20)) {
        console.log(`  • SKU "${sku}" em ${list.length} produtos:`);
        for (const item of list.slice(0, 4)) {
          console.log(`      - ${item.item_id}  ${item.title || "(sem titulo)"}`);
        }
        if (list.length > 4) console.log(`      ... e mais ${list.length - 4}`);
      }
    }

    printSection("6️⃣  PROBLEMAS DE CADASTRO");
    console.log(`  Sem SKU:  ${noSkuItems.length} produto(s)`);
    console.log(`  Sem brand: ${noBrandItems.length} produto(s)`);
    let withoutModel = 0;
    for (const list of noModelByBrand.values()) withoutModel += list.length;
    console.log(`  Sem modelo (com brand): ${withoutModel} produto(s)`);
  }

  printSection("📋  RESUMO E PROXIMOS PASSOS");
  const recommendations = [];
  if (unknownRawBrands.length > 0) {
    const top = unknownRawBrands.slice(0, 5).map(([b]) => b).join(", ");
    recommendations.push(`Avaliar adicionar em KNOWN_BRANDS: ${top}`);
  }
  if (potentialBrands.length > 0) {
    const top = potentialBrands.slice(0, 5).map(([b]) => b).join(", ");
    recommendations.push(`Confirmar se sao marcas e adicionar: ${top}`);
  }
  if (missingModels.length > 0) {
    const top = missingModels.slice(0, 3).map((m) => `${m.brand}:${m.model}`).join(", ");
    recommendations.push(`Adicionar em KNOWN_MODELS: ${top}`);
  }
  if (noBrandItems.length > 0) {
    recommendations.push(
      `Investigar ${noBrandItems.length} produtos sem brand: rode com --no-brand pra ver lista`
    );
  }
  if (duplicateSkus.length > 0) {
    recommendations.push(
      `Resolver ${duplicateSkus.length} SKUs duplicados (mesmo SKU em multiplos item_id)`
    );
  }
  if (recommendations.length === 0) {
    console.log("  ✓ Nada urgente — estoque bem catalogado!");
  } else {
    for (let i = 0; i < recommendations.length; i++) {
      console.log(`  ${i + 1}. ${recommendations[i]}`);
    }
  }

  console.log("\n  Comandos uteis:");
  console.log("    --suggestions   so sugestoes (sem listagem completa)");
  console.log("    --no-brand      lista produtos sem marca identificada");
  console.log("    --json          saida JSON pra processamento\n");

  db.close();
}

try {
  main();
} catch (error) {
  console.error(`[erro] ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exit(1);
}
