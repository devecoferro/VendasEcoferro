// Sincroniza produtos do ML (SQLite local) → Supabase (ecoferro.com.br)
import { createClient } from "@supabase/supabase-js";
import { db } from "../_lib/db.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getConnectionById } from "./_lib/storage.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("sync-to-website");

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
// Service role key é necessária para escrita server-side (bypassa RLS)
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Marcas conhecidas ────────────────────────────────────────────
const KNOWN_BRANDS = [
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "BMW", "Harley-Davidson",
  "Ducati", "Triumph", "KTM", "Royal Enfield", "Shineray", "Dafra",
  "Kasinski", "Haojue", "Bajaj", "CF Moto", "Benelli", "Husqvarna",
  "Aprilia",
];
const OWN_BRANDS = ["Ecoferro", "Fantom"];
const BRAND_ALIASES = {
  harley: "Harley-Davidson", hd: "Harley-Davidson",
  kawazaki: "Kawasaki", kavasaki: "Kawasaki",
  "cf-moto": "CF Moto", cfmoto: "CF Moto",
  "royal enfield": "Royal Enfield", royalenfield: "Royal Enfield",
};

/**
 * Normaliza a marca bruta do ML para um nome limpo.
 * Prioridade: título do anúncio > campo brand dos atributos.
 * Retorna null se não conseguir identificar.
 */
function normalizeBrand(rawBrand, title) {
  const titleLower = (title || "").toLowerCase();

  // 1. Procurar marcas conhecidas no título
  for (const brand of KNOWN_BRANDS) {
    if (titleLower.includes(brand.toLowerCase())) return brand;
  }
  for (const brand of OWN_BRANDS) {
    if (titleLower.includes(brand.toLowerCase())) return brand;
  }

  // 2. Tentar o campo brand dos atributos ML
  if (rawBrand) {
    const raw = rawBrand.trim();
    const lower = raw.toLowerCase();
    if (BRAND_ALIASES[lower]) return BRAND_ALIASES[lower];
    for (const brand of KNOWN_BRANDS) {
      if (lower === brand.toLowerCase()) return brand;
    }
    for (const brand of OWN_BRANDS) {
      if (lower === brand.toLowerCase()) return brand;
    }
    // Só aceita se for curto e limpo (sem descrição de produto)
    if (raw.length > 1 && raw.length < 25 && !/\d{5,}/.test(raw) && !raw.includes(" ")) {
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }

  return null;
}

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

// ── Melhorar URL da imagem ML ────────────────────────────────────
// Thumbnails do ML usam sufixo -I.jpg (tiny ~70px). Trocamos para
// -O.jpg (large ~500px) que é a melhor qualidade via URL direta.
function upgradeImageUrl(url) {
  if (!url) return url;
  return url
    .replace("http://", "https://")
    .replace(/-[IDCF]\.jpg$/i, "-O.jpg");
}

// ── Buscar todas as fotos e vídeo de um item na API do ML ───────
async function fetchItemMedia(accessToken, itemId) {
  if (!accessToken || !itemId) return { pictures: [], videoUrl: null };

  try {
    const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return { pictures: [], videoUrl: null };

    const data = await resp.json();

    // Extrair todas as imagens em alta qualidade
    const pictures = (data.pictures || [])
      .filter((p) => p?.secure_url || p?.url)
      .map((p) => upgradeImageUrl(p.secure_url || p.url));

    // Extrair vídeo se existir
    let videoUrl = null;
    if (data.video_id) {
      videoUrl = `https://www.youtube.com/embed/${data.video_id}`;
    }

    return { pictures, videoUrl };
  } catch {
    return { pictures: [], videoUrl: null };
  }
}

// ── Sincronizar TODAS as imagens de um produto ──────────────────
async function syncAllImages(supabase, productId, pictures) {
  if (!pictures || !pictures.length) return;

  // Buscar imagens existentes do produto
  const { data: existingImgs } = await supabase
    .from("product_images")
    .select("id, url")
    .eq("product_id", productId);

  const existingUrls = new Set((existingImgs || []).map((i) => i.url));

  for (let i = 0; i < pictures.length; i++) {
    const url = pictures[i];
    if (existingUrls.has(url)) continue;

    await supabase.from("product_images").insert({
      product_id: productId,
      url,
      is_primary: i === 0 && (!existingImgs || existingImgs.length === 0),
      sort_order: i,
    });
  }

  // Se a imagem primária atual não é mais a primeira, corrigir
  if (existingImgs && existingImgs.length === 0 && pictures.length > 0) {
    await supabase
      .from("product_images")
      .update({ is_primary: true, sort_order: 0 })
      .eq("product_id", productId)
      .eq("url", pictures[0]);
  }
}

// ── Auto-categorizar produto baseado no título ──────────────────
const CATEGORY_RULES = [
  { pattern: /^suport.*placa|^suporte.*placa/i, parentId: "a0000000-0000-0000-0000-000000000002",
    sub: [
      { pattern: /articulad|art\./i, id: "b0000000-0000-0000-0000-000000000004" },
      { pattern: /fixo/i, id: "b0000000-0000-0000-0000-000000000003" },
    ]},
  { pattern: /^eliminador|^elimiador/i, parentId: "a0000000-0000-0000-0000-000000000001",
    sub: [
      { pattern: /articulad/i, id: "b0000000-0000-0000-0000-000000000002" },
      { pattern: /fixo/i, id: "b0000000-0000-0000-0000-000000000001" },
    ]},
  { pattern: /protetor.*radiador|tela.*protetor.*radiador/i, parentId: "a0000000-0000-0000-0000-000000000003" },
  { pattern: /^slider|protetor.*carenag/i, parentId: "a0000000-0000-0000-0000-000000000004",
    sub: [
      { pattern: /escapamento/i, id: "b0000000-0000-0000-0000-000000000006" },
      { pattern: /carenag/i, id: "b0000000-0000-0000-0000-000000000005" },
    ]},
  { pattern: /protetor.*carter|grade protetora.*carter/i, parentId: "a0000000-0000-0000-0000-000000000005" },
  { pattern: /^bolha|parabrisa/i, parentId: "a0000000-0000-0000-0000-000000000006" },
  { pattern: /setas? pisca|piscas? led|^adaptador.*pisca|^adaptador.*seta|^0[24] setas|^suporte.*setas|^suporte.*pisca/i,
    parentId: "a0000000-0000-0000-0000-000000000007" },
  { pattern: /^lanterna|lanterna integrada|lente para lanterna/i, parentId: "b0000000-0000-0000-0000-000000000007" },
  { pattern: /luz de placa|parafuso.*luz.*placa|^par parafuso luz/i, parentId: "b0000000-0000-0000-0000-000000000008" },
];

function autoCategorizeName(title) {
  const name = (title || "").trim();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(name)) {
      // Tentar subcategoria
      if (rule.sub) {
        for (const sub of rule.sub) {
          if (sub.pattern.test(name)) return sub.id;
        }
      }
      return rule.parentId;
    }
  }
  return "a0000000-0000-0000-0000-000000000009"; // Acessórios
}

// ── Obter token de acesso do ML (para buscar fotos) ─────────────
async function getMLAccessToken() {
  try {
    const connections = db
      .prepare("SELECT id FROM ml_connections WHERE is_active = 1 LIMIT 1")
      .all();
    if (!connections.length) return null;

    const conn = getConnectionById(connections[0].id);
    if (!conn) return null;

    const validConn = await ensureValidAccessToken(conn);
    return validConn.access_token || null;
  } catch {
    return null;
  }
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

  try {
    // 0. Obter token ML para buscar todas as fotos
    const accessToken = await getMLAccessToken();
    if (accessToken) {
      log.info("Token ML obtido - imagens completas serao sincronizadas");
    } else {
      log.warn("Sem token ML - apenas thumbnail sera sincronizado");
    }

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
    let imagesAdded = 0;

    for (const item of mlItems) {
      try {
        // Resolver marca (normaliza para evitar lixo no catálogo)
        const cleanBrand = normalizeBrand(item.brand, item.title);
        const brandId = await getOrCreateBrand(supabase, cleanBrand);

        // Auto-categorizar produto baseado no título
        const categoryId = autoCategorizeName(item.title);

        // Buscar todas as fotos via API do ML
        const { pictures, videoUrl } = await fetchItemMedia(accessToken, item.item_id);

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
          category_id: categoryId,
        };

        if (videoUrl) {
          productData.video_url = videoUrl;
        }

        const existing = existingByMlId.get(item.item_id);

        if (existing) {
          // UPDATE: preço, estoque, marca, categoria, vídeo
          const updateFields = {
            price: productData.price,
            stock: productData.stock,
            ml_id: productData.ml_id,
            ml_permalink: productData.ml_permalink,
            sku: productData.sku,
            brand_id: productData.brand_id,
            category_id: productData.category_id,
            is_active: true,
          };
          if (videoUrl) updateFields.video_url = videoUrl;

          const { error: updateErr } = await supabase
            .from("products")
            .update(updateFields)
            .eq("id", existing.id);

          if (updateErr) {
            log.error(`Update error ${item.item_id}: ${updateErr.message}`);
            errors++;
            continue;
          }

          // Sincronizar TODAS as imagens
          if (pictures.length > 0) {
            await syncAllImages(supabase, existing.id, pictures);
            imagesAdded += pictures.length;
          } else if (item.thumbnail) {
            await syncAllImages(supabase, existing.id, [upgradeImageUrl(item.thumbnail)]);
          }

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
            // Sincronizar TODAS as imagens
            if (pictures.length > 0) {
              await syncAllImages(supabase, createdProduct.id, pictures);
              imagesAdded += pictures.length;
            } else if (item.thumbnail) {
              await syncAllImages(supabase, createdProduct.id, [upgradeImageUrl(item.thumbnail)]);
            }

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

    const summary = { created, updated, errors, imagesAdded, total: mlItems.length };
    log.info(`Sync concluido: ${JSON.stringify(summary)}`);

    return res.json({ success: true, ...summary });
  } catch (err) {
    log.error(`Sync fatal: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}
