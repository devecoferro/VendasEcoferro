// Corrige marcas no Supabase:
// 1. Mescla "Ecofero" (typo) → "Ecoferro"
// 2. Adiciona logos nas marcas conhecidas

import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Logos das marcas (URLs públicas simples)
const BRAND_LOGOS = {
  bmw: "https://logos-world.net/wp-content/uploads/2020/07/BMW-Logo.png",
  honda: "https://logos-world.net/wp-content/uploads/2022/02/Honda-Motorcycles-Logo.png",
  yamaha: "https://logos-world.net/wp-content/uploads/2021/02/Yamaha-Logo.png",
  kawasaki: "https://logos-world.net/wp-content/uploads/2021/09/Kawasaki-Logo.png",
  suzuki: "https://logos-world.net/wp-content/uploads/2021/09/Suzuki-Logo.png",
  kasinski: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Kasinski.svg/200px-Kasinski.svg.png",
  ecoferro: "https://www.ecoferro.com.br/assets/ecoferro-logo-9USc07aS.jpeg",
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Use POST" });
  }

  try {
    await requireAuthenticatedProfile(request);

    if (!SUPABASE_KEY) {
      return response.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY nao configurada" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const result = { merged: 0, logos_added: 0, errors: [] };

    // 1. Buscar marcas
    const { data: brands } = await supabase.from("brands").select("*");
    const bySlug = new Map();
    for (const b of brands || []) bySlug.set(b.slug, b);

    // 2. Mesclar Ecofero (typo) → Ecoferro
    const typo = bySlug.get("ecofero");
    const correct = bySlug.get("ecoferro");
    if (typo && correct) {
      // Migrar produtos
      const { error: updErr, count } = await supabase
        .from("products")
        .update({ brand_id: correct.id }, { count: "exact" })
        .eq("brand_id", typo.id);

      if (updErr) {
        result.errors.push({ op: "migrate_products", error: updErr.message });
      } else {
        result.merged = count || 0;
        // Deletar marca typo
        const { error: delErr } = await supabase.from("brands").delete().eq("id", typo.id);
        if (delErr) result.errors.push({ op: "delete_typo", error: delErr.message });
      }
    }

    // 3. Adicionar logos
    for (const [slug, url] of Object.entries(BRAND_LOGOS)) {
      const brand = bySlug.get(slug);
      if (!brand) continue;
      const { error } = await supabase
        .from("brands")
        .update({ logo_url: url })
        .eq("id", brand.id);
      if (error) {
        result.errors.push({ op: "logo_" + slug, error: error.message });
      } else {
        result.logos_added += 1;
      }
    }

    return response.status(200).json(result);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
