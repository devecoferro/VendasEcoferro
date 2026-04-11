// Sincroniza produtos do ML (SQLite local) → Supabase (ecoferro.com.br)
import { createClient } from "@supabase/supabase-js";
import { getDb } from "../_lib/db.js";
import { createLogger } from "../_lib/logger.js";

const log = createLogger("sync-to-website");

const SUPABASE_URL = "https://patlhzysljihbqemsjzn.supabase.co";
// Service role key é necessária para escrita server-side (bypassa RLS)
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Marcas conhecidas ────────────────────────────────────────────
const KNOWN_BRANDS = [
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Harley-Davidson",
  "Ducati", "Triumph", "KTM", "Royal Enfield", "Shineray", "Dafra",
  "Kasinski", "Haojue", "Bajaj", "CF Moto", "Benelli", "Husqvarna",
  "Aprilia",
];

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 150);
}

// ── Buscar ou criar marca no Supabase ───────────────────────────
const brandCache = new Map();

async function getOrCreateBrand(supabase, brandName) {
  if (!brandName) return null;

  const key = brandName.toLowerCase();
  if (brandCache.has(key)) return brandCache.get(key);

  const { data: existing } = await supabase
    .from("brands")
    .select("id")
    .ilike("name", brandName)
    .limit(1)
    .maybeSingle();

  if (existing) {
    brandCache.set(key, existing.id);
    return existing.id;
  }

  const { data: created } = await supabase
    .from("brands")
    .insert({ name: brandName, slug: slugify(brandName) })
    .select("id")
    .single();

  if (created) {
    brandCache.set(key, created.id);
    return created.id;
  }

  return null;
}

// ── Sincronizar imagens ──────────────────────────────────────────
async function syncImages(supabase, productId, thumbnailUrl) {
  if (!thumbnailUrl) return;

  const url = thumbnailUrl.replace("http://", "https://");

  // Verificar se já existe
  const { data: existing } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("url", url)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  // Verificar se já tem alguma imagem
  const { data: anyImage } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();

  await supabase.from("product_images").insert({
    product_id: productId,
    url,
    is_primary: !anyImage,
    sort_order: anyImage ? 1 : 0,
  });
}

// ── Handler principal ────────────────────────────────────────────
export async function handleSyncToWebsite(req, res) {
  if (!SUPABASE_KEY) {
    return res.status(500).json({
      success: false,
      error: "SUPABASE_SERVICE_ROLE_KEY nao configurada. Adicione a variavel de ambiente no container.",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const db = getDb();

  try {
    // 1. Ler todos os itens ativos do ML stock local
    const mlItems = db
      .prepare(`
        SELECT item_id, sku, title, available_quantity, sold_quantity,
               price, thumbnail, status, condition, brand, model, vehicle_year
        FROM ml_stock
        WHERE status = 'active'
        ORDER BY title
      `)
      .all();

    log.info(`Lendo ${mlItems.length} itens ativos do ML stock`);

    if (!mlItems.length) {
      return res.json({ success: true, created: 0, updated: 0, total: 0 });
    }

    // 2. Buscar produtos existentes no Supabase por ml_id
    const { data: existingProducts, error: fetchErr } = await supabase
      .from("products")
      .select("id, ml_id, slug");

    if (fetchErr) throw new Error(`Supabase fetch error: ${fetchErr.message}`);

    const existingByMlId = new Map();
    for (const p of existingProducts || []) {
      if (p.ml_id) existingByMlId.set(p.ml_id, { id: p.id, slug: p.slug });
    }

    // 3. Buscar slugs existentes para evitar conflitos
    const usedSlugs = new Set((existingProducts || []).map((p) => p.slug));

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const item of mlItems) {
      try {
        // Resolver marca
        const brandId = await getOrCreateBrand(supabase, item.brand);

        // Dados do produto
        const productData = {
          name: item.title,
          price: item.price || 0,
          stock: item.available_quantity || 0,
          ml_id: item.item_id,
          ml_permalink: `https://www.mercadolivre.com.br/p/${item.item_id}`,
          sku: item.sku || null,
          is_active: true,
          brand_id: brandId,
        };

        const existing = existingByMlId.get(item.item_id);

        if (existing) {
          // UPDATE: preço, estoque, marca
          const { error: updateErr } = await supabase
            .from("products")
            .update({
              price: productData.price,
              stock: productData.stock,
              ml_id: productData.ml_id,
              ml_permalink: productData.ml_permalink,
              sku: productData.sku,
              brand_id: productData.brand_id,
              is_active: true,
            })
            .eq("id", existing.id);

          if (updateErr) {
            log.error(`Update error ${item.item_id}: ${updateErr.message}`);
            errors++;
            continue;
          }

          await syncImages(supabase, existing.id, item.thumbnail);
          updated++;
        } else {
          // INSERT: novo produto
          let baseSlug = slugify(item.title || item.item_id);
          let slug = baseSlug;
          let suffix = 1;
          while (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${suffix++}`;
          }

          productData.slug = slug;
          productData.short_description = `${item.brand || ""} ${item.model || ""} ${item.vehicle_year || ""}`.trim() || null;

          const { data: createdProduct, error: insertErr } = await supabase
            .from("products")
            .insert(productData)
            .select("id")
            .single();

          if (insertErr) {
            log.error(`Insert error ${item.item_id}: ${insertErr.message}`);
            errors++;
            continue;
          }

          if (createdProduct) {
            await syncImages(supabase, createdProduct.id, item.thumbnail);

            // Mapeamento externo
            await supabase.from("product_external_mappings").upsert(
              {
                product_id: createdProduct.id,
                source_system: "mercado_livre",
                external_product_id: item.item_id,
                external_sku: item.sku || null,
                is_active: true,
                metadata: { auto_synced: true, synced_at: new Date().toISOString() },
              },
              { onConflict: "product_id,source_system" },
            );

            usedSlugs.add(slug);
            created++;
          }
        }
      } catch (itemErr) {
        log.error(`Item error ${item.item_id}: ${itemErr.message}`);
        errors++;
      }
    }

    const summary = { created, updated, errors, total: mlItems.length };
    log.info(`Sync concluido: ${JSON.stringify(summary)}`);

    return res.json({ success: true, ...summary });
  } catch (err) {
    log.error(`Sync fatal: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}
