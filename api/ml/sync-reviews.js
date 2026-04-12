// Sincroniza avaliações do Mercado Livre → Supabase (reviews table)
import { createClient } from "@supabase/supabase-js";
import { db } from "../_lib/db.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getConnectionById } from "./_lib/storage.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("sync-reviews");

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Obter token de acesso do ML ─────────────────────────────────
async function getMLAccessToken() {
  try {
    const connections = db.prepare("SELECT id FROM ml_connections LIMIT 1").all();
    if (!connections.length) return null;
    const conn = getConnectionById(connections[0].id);
    if (!conn) return null;
    const validConn = await ensureValidAccessToken(conn);
    return validConn.access_token || null;
  } catch (err) {
    log.warn(`Falha ao obter token ML: ${err.message}`);
    return null;
  }
}

// ── Buscar avaliações de um item na API do ML ───────────────────
async function fetchReviewsForItem(accessToken, itemId) {
  const allReviews = [];
  let offset = 0;
  const limit = 50;

  try {
    while (true) {
      const resp = await fetch(
        `https://api.mercadolibre.com/reviews/item/${itemId}?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!resp.ok) {
        if (resp.status === 404) break; // Item sem avaliações
        log.warn(`Reviews API ${resp.status} para ${itemId}`);
        break;
      }

      const data = await resp.json();
      const reviews = data.reviews || [];

      for (const r of reviews) {
        // Extrair fotos da avaliação
        const photos = [];
        if (r.media && r.media.length > 0) {
          for (const m of r.media) {
            if (m.variations && m.variations.length > 0) {
              // Pegar a maior variação (último item geralmente é -F.jpg)
              const largest = m.variations[m.variations.length - 1];
              if (largest.secure_url || largest.url) {
                photos.push(largest.secure_url || largest.url);
              }
            }
          }
        }

        allReviews.push({
          ml_review_id: String(r.id),
          rating: r.rate || r.rating || 5,
          title: r.title || null,
          comment: r.content || null,
          photos,
          created_at: r.date_created || new Date().toISOString(),
        });
      }

      // Verificar se há mais páginas
      if (reviews.length < limit || allReviews.length >= (data.paging?.total || data.total || 0)) {
        break;
      }
      offset += limit;
    }
  } catch (err) {
    log.warn(`Erro ao buscar reviews de ${itemId}: ${err.message}`);
  }

  return allReviews;
}

// ── Handler principal ────────────────────────────────────────────
export async function handleSyncReviews(req, res) {
  if (!SUPABASE_KEY) {
    return res.status(500).json({
      success: false,
      error: "SUPABASE_SERVICE_ROLE_KEY nao configurada.",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const accessToken = await getMLAccessToken();
    if (!accessToken) {
      return res.status(500).json({ success: false, error: "Sem token ML disponivel" });
    }

    log.info("Token ML obtido - iniciando sync de avaliacoes");

    // Buscar todos os produtos com ml_id
    const { data: products, error: fetchErr } = await supabase
      .from("products")
      .select("id, ml_id, name")
      .not("ml_id", "is", null);

    if (fetchErr) throw new Error(`Supabase fetch error: ${fetchErr.message}`);

    log.info(`${products.length} produtos com ml_id encontrados`);

    let totalReviews = 0;
    let totalPhotos = 0;
    let productsWithReviews = 0;
    let errors = 0;

    for (const product of products) {
      try {
        const reviews = await fetchReviewsForItem(accessToken, product.ml_id);
        if (!reviews.length) continue;

        productsWithReviews++;

        // Buscar reviews existentes deste produto para evitar duplicatas
        const { data: existing } = await supabase
          .from("reviews")
          .select("ml_review_id")
          .eq("product_id", product.id)
          .not("ml_review_id", "is", null);

        const existingIds = new Set((existing || []).map((r) => r.ml_review_id));

        for (const review of reviews) {
          if (existingIds.has(review.ml_review_id)) continue;

          const { error: insertErr } = await supabase.from("reviews").insert({
            product_id: product.id,
            ml_review_id: review.ml_review_id,
            customer_name: "Cliente ML",
            rating: review.rating,
            title: review.title,
            comment: review.comment,
            photos: review.photos.length > 0 ? review.photos : [],
            is_approved: true,
            created_at: review.created_at,
          });

          if (insertErr) {
            // Pode ser duplicate key (ml_review_id unique constraint)
            if (!insertErr.message.includes("duplicate")) {
              log.warn(`Insert review error (${product.ml_id}): ${insertErr.message}`);
            }
            continue;
          }

          totalReviews++;
          totalPhotos += review.photos.length;
        }

        // Rate limit: pequena pausa entre itens para não estourar API
        await new Promise((r) => setTimeout(r, 200));
      } catch (itemErr) {
        log.warn(`Erro reviews ${product.ml_id}: ${itemErr.message}`);
        errors++;
      }
    }

    const summary = { productsWithReviews, totalReviews, totalPhotos, errors, totalProducts: products.length };
    log.info(`Sync reviews concluido: ${JSON.stringify(summary)}`);

    return res.json({ success: true, ...summary });
  } catch (err) {
    log.error(`Sync reviews fatal: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}
