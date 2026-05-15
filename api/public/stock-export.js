// GET /api/public/stock-export
// Endpoint público read-only que devolve uma lista consolidada
// de estoque por SKU (somando todas as connections — Fantom + EcoFerro)
// para ser consumido pela edge function `sync-ml-stock` do Supabase
// do site novo (patlhzysljihbqemsjzn).
//
// Auth: Bearer token via env STOCK_EXPORT_TOKEN.
// Retorno: { generated_at, total, items: [{ sku, title, brand, stock, status, price, thumbnail, item_id, permalink }] }

import { db } from "../_lib/db.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("public-stock-export");

function getBearerToken(req) {
  const raw = req.headers?.authorization || "";
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET." });
  }

  const expected = (process.env.STOCK_EXPORT_TOKEN || "").trim();
  if (!expected) {
    log.warn("STOCK_EXPORT_TOKEN nao configurada");
    return res.status(503).json({
      error: "STOCK_EXPORT_TOKEN nao configurada no servidor.",
    });
  }

  const supplied = getBearerToken(req);
  if (!supplied || supplied !== expected) {
    return res.status(401).json({ error: "Token invalido." });
  }

  try {
    // Agrupa por SKU somando available_quantity de todas as connections
    // (Fantom + EcoFerro). Inclui apenas SKUs com SKU não-nulo.
    // Inclui price, thumbnail e item_id do anúncio com maior estoque (ou mais recente).
    const rows = db
      .prepare(
        `
        SELECT
          sku,
          SUM(available_quantity) AS stock,
          MAX(title) AS title,
          MAX(brand) AS brand,
          GROUP_CONCAT(DISTINCT status) AS statuses,
          MAX(price) AS price,
          MAX(thumbnail) AS thumbnail,
          MAX(item_id) AS item_id
        FROM ml_stock
        WHERE sku IS NOT NULL AND TRIM(sku) <> ''
        GROUP BY sku
        ORDER BY sku
      `,
      )
      .all();

    const items = rows.map((r) => {
      // Converter thumbnail HTTP para HTTPS e aumentar resolução
      let thumbnail = r.thumbnail ?? null;
      if (thumbnail) {
        thumbnail = thumbnail.replace(/^http:\/\//, "https://");
        // ML thumbnails: trocar -I.jpg por -O.jpg para imagem maior (500x500)
        thumbnail = thumbnail.replace(/-I\.jpg$/i, "-O.jpg").replace(/-I\.webp$/i, "-O.webp");
      }

      // Construir permalink do ML a partir do item_id
      const itemId = r.item_id ?? null;
      const permalink = itemId
        ? `https://www.mercadolivre.com.br/p/${itemId}`
        : null;

      return {
        sku: String(r.sku).trim(),
        title: r.title ?? null,
        brand: r.brand ?? null,
        stock: Number(r.stock || 0),
        // status é "active" se pelo menos uma connection tem ativo
        status: typeof r.statuses === "string" && r.statuses.includes("active") ? "active" : "inactive",
        price: r.price ? Number(r.price) : null,
        thumbnail,
        item_id: itemId,
        permalink,
      };
    });

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      total: items.length,
      items,
    });
  } catch (err) {
    log.error("Falha ao gerar stock-export", { error: err?.message });
    return res.status(500).json({ error: "Erro interno ao consultar estoque." });
  }
}
