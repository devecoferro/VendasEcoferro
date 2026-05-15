// GET /api/public/products-export
// Endpoint público read-only que devolve lista completa de produtos/anúncios ML
// com todos os dados necessários para o site (price, thumbnail, item_id, title, etc.)
// para ser consumido pela edge function `sync-ml-stock` do Supabase do site.
//
// Auth: Bearer token via env STOCK_EXPORT_TOKEN.
// Retorno: { generated_at, total, items: [{ item_id, sku, title, brand, stock, status, price, thumbnail, permalink }] }

import { db } from "../_lib/db.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("public-products-export");

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
    // Busca todos os anúncios ativos do ML com dados completos
    // Agrupa por item_id para evitar duplicatas entre connections
    const rows = db
      .prepare(
        `
        SELECT
          item_id,
          MAX(sku) AS sku,
          MAX(title) AS title,
          MAX(brand) AS brand,
          SUM(available_quantity) AS stock,
          MAX(price) AS price,
          MAX(thumbnail) AS thumbnail,
          GROUP_CONCAT(DISTINCT status) AS statuses,
          MAX(listing_type) AS listing_type
        FROM ml_stock
        WHERE item_id IS NOT NULL AND TRIM(item_id) <> ''
        GROUP BY item_id
        ORDER BY item_id
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

      const itemId = r.item_id ?? null;
      const isActive = typeof r.statuses === "string" && r.statuses.includes("active");

      return {
        item_id: itemId,
        sku: r.sku ? String(r.sku).trim() : null,
        title: r.title ?? null,
        brand: r.brand ?? null,
        stock: Number(r.stock || 0),
        status: isActive ? "active" : "inactive",
        price: r.price ? Number(r.price) : null,
        thumbnail,
        permalink: itemId ? `https://produto.mercadolivre.com.br/${itemId}` : null,
      };
    });

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      total: items.length,
      items,
    });
  } catch (err) {
    log.error("Falha ao gerar products-export", { error: err?.message });
    return res.status(500).json({ error: "Erro interno ao consultar produtos." });
  }
}
