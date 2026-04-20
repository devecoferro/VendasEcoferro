// ─── Endpoint HTTP de auditoria de marcas/modelos do estoque ───────────
//
// Substitui a necessidade de SSH na VPS pra rodar scripts/audit-stock-brands.mjs.
// O operador acessa via browser (autenticado como admin) e ve um relatorio
// HTML formatado, ou consome o JSON via fetch.
//
// Endpoints:
//   GET /api/ml/admin/audit-brands              → JSON
//   GET /api/ml/admin/audit-brands?format=html  → HTML standalone
//
// Read-only no banco — seguro chamar a qualquer hora sem afetar producao.
// Apenas admins acessam (auth via requireAdmin).

import { db } from "../../_lib/db.js";
import { requireAdmin } from "../../_lib/auth-server.js";

const KNOWN_BRANDS = [
  "Mottu",
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Ducati", "Triumph",
  "Harley-Davidson", "KTM", "Husqvarna", "Royal Enfield", "Kasinski",
  "Benelli", "MV Agusta", "Aprilia", "Dafra", "Shineray",
];
const OWN_BRANDS = ["Ecoferro", "Fantom"];

const POTENTIAL_BRAND_KEYWORDS = [
  "Bajaj", "Voge", "Sym", "Kymco", "Piaggio", "Vespa", "GreenSport",
  "Garinni", "Haojue", "Lifan", "Loncin", "Sundown", "Avelloz",
  "Brava", "Mahindra", "Hero", "TVS", "Bull", "CFMoto", "GTR", "Buell",
  "Niu", "Voltz", "Watts", "Custom", "Cafe Racer",
];

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

function buildAuditReport() {
  const items = db
    .prepare(
      `SELECT item_id, sku, title, brand, model, vehicle_year, status,
              available_quantity, sold_quantity
       FROM ml_stock`
    )
    .all();

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

  // Marcas raw vindas do ML que nao sao conhecidas
  const unknownRawBrandCounts = new Map();
  for (const item of items) {
    if (!item.brand || isBrandKnown(item.brand)) continue;
    const key = item.brand.trim();
    if (key.length >= 30 || /\d{4}/.test(key)) continue;
    unknownRawBrandCounts.set(
      key,
      (unknownRawBrandCounts.get(key) || 0) + 1
    );
  }
  const unknownRawBrands = [...unknownRawBrandCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  // Marcas potenciais detectadas em titulos sem brand
  const potentialBrandCounts = new Map();
  for (const item of items) {
    if (item.brand) continue;
    const text = normalizeForCompare(item.title);
    if (!text) continue;
    for (const keyword of POTENTIAL_BRAND_KEYWORDS) {
      if (text.includes(normalizeForCompare(keyword))) {
        potentialBrandCounts.set(
          keyword,
          (potentialBrandCounts.get(keyword) || 0) + 1
        );
      }
    }
  }
  const potentialBrands = [...potentialBrandCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  // Modelos potenciais nao detectados (CB300, MT09, etc)
  const missingModelCounts = new Map();
  for (const item of items) {
    if (!item.brand || !isBrandKnown(item.brand) || item.model) continue;
    const tokens = tokenize(item.title);
    for (const token of tokens) {
      if (/^[A-Za-z]{1,4}\d{1,4}$/.test(token)) {
        const key = `${item.brand}:${token.toUpperCase()}`;
        missingModelCounts.set(key, (missingModelCounts.get(key) || 0) + 1);
      }
    }
  }
  const missingModels = [...missingModelCounts.entries()]
    .map(([key, count]) => {
      const [brand, model] = key.split(":");
      return { brand, model, count };
    })
    .sort((a, b) => b.count - a.count);

  // SKUs duplicados
  const skuCounts = new Map();
  for (const item of items) {
    if (!item.sku) continue;
    const key = item.sku.trim().toUpperCase();
    if (!skuCounts.has(key)) skuCounts.set(key, []);
    skuCounts.get(key).push(item);
  }
  const duplicateSkus = [...skuCounts.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([sku, list]) => ({
      sku,
      count: list.length,
      items: list.map((i) => ({
        item_id: i.item_id,
        title: i.title,
      })),
    }));

  let withoutModel = 0;
  for (const list of noModelByBrand.values()) withoutModel += list.length;

  return {
    generated_at: new Date().toISOString(),
    total_items: items.length,
    brand_counts: sortedBrandCounts.map(([brand, count]) => ({
      brand,
      count,
      pct: Number(((count / items.length) * 100).toFixed(1)),
      known: brand !== "(sem marca)" && isBrandKnown(brand),
      no_brand: brand === "(sem marca)",
    })),
    no_brand_count: noBrandItems.length,
    no_brand_sample: noBrandItems.slice(0, 50).map((i) => ({
      item_id: i.item_id,
      title: i.title,
      sku: i.sku,
    })),
    unknown_raw_brands: unknownRawBrands.map(([brand, count]) => ({
      brand,
      count,
    })),
    potential_brand_keywords: potentialBrands.map(([brand, count]) => ({
      brand,
      count,
    })),
    missing_models: missingModels.slice(0, 50),
    duplicate_skus: duplicateSkus.slice(0, 30),
    no_sku_count: noSkuItems.length,
    without_model_count: withoutModel,
  };
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtmlReport(report) {
  const recommendations = [];
  if (report.unknown_raw_brands.length > 0) {
    const top = report.unknown_raw_brands.slice(0, 5).map((b) => b.brand).join(", ");
    recommendations.push(`Avaliar adicionar em KNOWN_BRANDS: <strong>${escapeHtml(top)}</strong>`);
  }
  if (report.potential_brand_keywords.length > 0) {
    const top = report.potential_brand_keywords.slice(0, 5).map((b) => b.brand).join(", ");
    recommendations.push(`Confirmar marcas e adicionar: <strong>${escapeHtml(top)}</strong>`);
  }
  if (report.missing_models.length > 0) {
    const top = report.missing_models.slice(0, 3).map((m) => `${m.brand}:${m.model}`).join(", ");
    recommendations.push(`Adicionar em KNOWN_MODELS: <strong>${escapeHtml(top)}</strong>`);
  }
  if (report.no_brand_count > 0) {
    recommendations.push(`Investigar <strong>${report.no_brand_count}</strong> produtos sem marca identificada (lista abaixo)`);
  }
  if (report.duplicate_skus.length > 0) {
    recommendations.push(`Resolver <strong>${report.duplicate_skus.length}</strong> SKUs duplicados`);
  }

  const brandRows = report.brand_counts
    .map((b) => {
      const tag = b.known ? "✓" : b.no_brand ? "✗" : "?";
      const cls = b.known ? "ok" : b.no_brand ? "err" : "warn";
      return `<tr class="${cls}"><td>${tag}</td><td>${escapeHtml(b.brand)}</td><td class="num">${b.count}</td><td class="num">${b.pct}%</td></tr>`;
    })
    .join("");

  const unknownRows = report.unknown_raw_brands
    .slice(0, 30)
    .map((b) => `<tr><td>${escapeHtml(b.brand)}</td><td class="num">${b.count}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="empty">Nenhuma — todas as marcas raw do ML estão normalizadas.</td></tr>`;

  const potentialRows = report.potential_brand_keywords
    .map((b) => `<tr><td>${escapeHtml(b.brand)}</td><td class="num">${b.count}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="empty">Nenhuma palavra-chave conhecida em produtos sem brand.</td></tr>`;

  const modelRows = report.missing_models
    .slice(0, 30)
    .map((m) => `<tr><td>${escapeHtml(m.brand)}</td><td><code>${escapeHtml(m.model)}</code></td><td class="num">${m.count}</td></tr>`)
    .join("") || `<tr><td colspan="3" class="empty">KNOWN_MODELS cobre bem.</td></tr>`;

  const dupRows = report.duplicate_skus
    .map((d) => {
      const titles = d.items.slice(0, 4).map((i) => `<li><code>${escapeHtml(i.item_id)}</code> — ${escapeHtml(i.title || "(sem título)")}</li>`).join("");
      const more = d.items.length > 4 ? `<li>... +${d.items.length - 4}</li>` : "";
      return `<tr><td><code>${escapeHtml(d.sku)}</code></td><td>${d.count}</td><td><ul>${titles}${more}</ul></td></tr>`;
    })
    .join("") || `<tr><td colspan="3" class="empty">Nenhum SKU duplicado.</td></tr>`;

  const noBrandRows = report.no_brand_sample
    .map((i) => `<tr><td><code>${escapeHtml(i.item_id)}</code></td><td>${escapeHtml(i.sku || "—")}</td><td>${escapeHtml(i.title || "(sem título)")}</td></tr>`)
    .join("") || `<tr><td colspan="3" class="empty">Todos os produtos têm marca.</td></tr>`;

  const recList = recommendations.length > 0
    ? `<ol>${recommendations.map((r) => `<li>${r}</li>`).join("")}</ol>`
    : `<p class="ok">✓ Nada urgente — estoque bem catalogado!</p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Auditoria de Marcas — ${report.total_items} produtos</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#f5f5f7;color:#1a1a1a;padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:16px;margin:32px 0 8px;padding-bottom:6px;border-bottom:2px solid #e5e5e5}
  .meta{color:#666;font-size:13px;margin-bottom:24px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
  .stat{background:#fff;padding:12px;border-radius:8px;border:1px solid #e5e5e5}
  .stat .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.04em}
  .stat .value{font-size:24px;font-weight:bold;color:#1a1a1a;margin-top:2px}
  .stat.warn .value{color:#d68410}
  .stat.err .value{color:#d63030}
  .recommendations{background:#fff8e1;border:1px solid #fde68a;padding:16px;border-radius:8px;margin-bottom:24px}
  .recommendations h2{margin-top:0;color:#92400e}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;margin-bottom:8px}
  th,td{padding:8px 12px;text-align:left;font-size:13px;border-bottom:1px solid #f0f0f0}
  th{background:#f9f9fb;font-weight:600;text-transform:uppercase;font-size:11px;color:#666;letter-spacing:0.04em}
  td.num{text-align:right;font-family:ui-monospace,monospace}
  tr.ok td:first-child{color:#22c55e;text-align:center}
  tr.warn td:first-child{color:#d68410;text-align:center}
  tr.err td:first-child{color:#d63030;text-align:center;font-weight:bold}
  td.empty{text-align:center;color:#999;font-style:italic;padding:16px}
  ul{margin:0;padding-left:18px}
  ul li{font-size:11px;color:#666}
  code{background:#f0f0f5;padding:1px 5px;border-radius:3px;font-size:12px}
  .ok{color:#16a34a}
  .reload{position:fixed;bottom:16px;right:16px;background:#3483fa;color:#fff;border:0;padding:10px 16px;border-radius:24px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(52,131,250,0.3)}
  .reload:hover{background:#2968c8}
  .legend{font-size:11px;color:#888;margin-top:4px}
</style>
</head>
<body>
  <h1>📊 Auditoria de Marcas e Modelos do Estoque</h1>
  <div class="meta">
    Gerado em ${escapeHtml(new Date(report.generated_at).toLocaleString("pt-BR"))}
    · ${report.total_items} produtos no estoque local
  </div>

  <div class="stats">
    <div class="stat"><div class="label">Total</div><div class="value">${report.total_items}</div></div>
    <div class="stat ${report.no_brand_count > 0 ? "err" : ""}"><div class="label">Sem marca</div><div class="value">${report.no_brand_count}</div></div>
    <div class="stat ${report.no_sku_count > 0 ? "warn" : ""}"><div class="label">Sem SKU</div><div class="value">${report.no_sku_count}</div></div>
    <div class="stat ${report.duplicate_skus.length > 0 ? "warn" : ""}"><div class="label">SKUs duplicados</div><div class="value">${report.duplicate_skus.length}</div></div>
  </div>

  <div class="recommendations">
    <h2>📋 Próximos passos</h2>
    ${recList}
  </div>

  <h2>1️⃣ Marcas detectadas</h2>
  <div class="legend">✓ conhecida · ? raw do ML não normalizada · ✗ sem brand identificada</div>
  <table>
    <thead><tr><th></th><th>Marca</th><th class="num">Produtos</th><th class="num">%</th></tr></thead>
    <tbody>${brandRows}</tbody>
  </table>

  <h2>2️⃣ Marcas raw do ML não catalogadas (candidatas a adicionar em KNOWN_BRANDS)</h2>
  <table>
    <thead><tr><th>Marca raw</th><th class="num">Produtos</th></tr></thead>
    <tbody>${unknownRows}</tbody>
  </table>

  <h2>3️⃣ Marcas potenciais detectadas em títulos (produtos sem brand)</h2>
  <table>
    <thead><tr><th>Palavra-chave</th><th class="num">Aparece em N títulos</th></tr></thead>
    <tbody>${potentialRows}</tbody>
  </table>

  <h2>4️⃣ Modelos potenciais não detectados</h2>
  <p class="legend">Padrões tipo CB300, MT09 em títulos onde KNOWN_MODELS não bateu</p>
  <table>
    <thead><tr><th>Marca</th><th>Modelo candidato</th><th class="num">Produtos</th></tr></thead>
    <tbody>${modelRows}</tbody>
  </table>

  <h2>5️⃣ SKUs duplicados (mesmo SKU em múltiplos item_id)</h2>
  <table>
    <thead><tr><th>SKU</th><th>Em N produtos</th><th>Produtos</th></tr></thead>
    <tbody>${dupRows}</tbody>
  </table>

  <h2>6️⃣ Produtos sem marca identificada (até 50 primeiros)</h2>
  <table>
    <thead><tr><th>item_id</th><th>SKU</th><th>Título</th></tr></thead>
    <tbody>${noBrandRows}</tbody>
  </table>

  <button class="reload" onclick="location.reload()">↻ Atualizar</button>
</body>
</html>`;
}

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Acesso negado." });
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({
      success: false,
      error: "Use GET.",
    });
  }

  let report;
  try {
    report = buildAuditReport();
  } catch (error) {
    console.error("[audit-brands] Falha ao gerar relatorio:", error);
    return response.status(500).json({
      success: false,
      error: error.message || "Falha ao gerar relatorio.",
    });
  }

  const format = String(request.query?.format || "json").toLowerCase();
  if (format === "html") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(renderHtmlReport(report));
  }

  return response.status(200).json({
    success: true,
    ...report,
  });
}
