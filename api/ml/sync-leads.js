// Sincroniza leads do Mercado Livre → Supabase (ecoferro.com.br/admin/leads)
import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getLatestConnection } from "./_lib/storage.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("sync-leads");

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Buscar leads da API ML ──────────────────────────────────────
async function fetchMLLeads(token, sellerId, { limit = 200, offset = 0 } = {}) {
  const url = `https://api.mercadolibre.com/users/${encodeURIComponent(sellerId)}/leads?limit=${limit}&offset=${offset}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    log.error(`ML leads API error: ${response.status} — ${text}`);
    return { results: [], paging: { total: 0 } };
  }

  return response.json();
}

// ── Mapear lead ML → formato Supabase ───────────────────────────
function mapLeadToSupabase(mlLead) {
  // A estrutura do lead ML pode variar. Campos comuns:
  // { id, name, email, phone, date_created, item_id, ... }
  return {
    nome: mlLead.name || mlLead.full_name || mlLead.contact_name || null,
    email: mlLead.email || mlLead.contact_email || null,
    telefone:
      mlLead.phone?.number ||
      mlLead.phone ||
      mlLead.contact_phone ||
      mlLead.phone_number ||
      null,
    origem: "Mercado Livre",
    data: mlLead.date_created || mlLead.created_at || new Date().toISOString(),
    // Campos extras para rastreamento
    ml_lead_id: String(mlLead.id || ""),
    ml_item_id: mlLead.item_id || mlLead.listing_id || null,
  };
}

// ── Sync principal ──────────────────────────────────────────────
async function syncLeadsToWebsite(token, sellerId) {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Buscar leads do ML (até 200 mais recentes)
  const mlData = await fetchMLLeads(token, sellerId, { limit: 200 });
  const mlLeads = Array.isArray(mlData.results)
    ? mlData.results
    : Array.isArray(mlData)
      ? mlData
      : [];

  if (mlLeads.length === 0) {
    return {
      success: true,
      ml_total: mlData.paging?.total || 0,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      message: "Nenhum lead encontrado na API do Mercado Livre.",
      raw_response_keys: Object.keys(mlData),
    };
  }

  // 2. Buscar leads existentes no Supabase para evitar duplicatas
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("ml_lead_id, email")
    .not("ml_lead_id", "is", null);

  const existingIds = new Set(
    (existingLeads || []).map((l) => l.ml_lead_id).filter(Boolean)
  );
  const existingEmails = new Set(
    (existingLeads || []).map((l) => l.email?.toLowerCase()).filter(Boolean)
  );

  // 3. Inserir novos leads
  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (const mlLead of mlLeads) {
    const mapped = mapLeadToSupabase(mlLead);

    // Skip se já existe pelo ml_lead_id ou email
    if (mapped.ml_lead_id && existingIds.has(mapped.ml_lead_id)) {
      skipped++;
      continue;
    }
    if (mapped.email && existingEmails.has(mapped.email.toLowerCase())) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from("leads").insert(mapped);

    if (error) {
      // Se a tabela não tem as colunas extras (ml_lead_id, ml_item_id),
      // tentar sem elas
      if (error.message?.includes("ml_lead_id") || error.code === "42703") {
        const { ml_lead_id, ml_item_id, ...basicLead } = mapped;
        const { error: retryError } = await supabase
          .from("leads")
          .insert(basicLead);

        if (retryError) {
          errors.push({
            lead: mapped.nome || mapped.email,
            error: retryError.message,
          });
        } else {
          inserted++;
        }
      } else {
        errors.push({
          lead: mapped.nome || mapped.email,
          error: error.message,
        });
      }
    } else {
      inserted++;
    }
  }

  return {
    success: true,
    ml_total: mlData.paging?.total || mlLeads.length,
    fetched: mlLeads.length,
    inserted,
    skipped,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    sample_lead: mlLeads[0]
      ? {
          raw_keys: Object.keys(mlLeads[0]),
          mapped: mapLeadToSupabase(mlLeads[0]),
        }
      : null,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Use POST para sincronizar leads." });
  }

  try {
    await requireAuthenticatedProfile(request);

    const connection = getLatestConnection();
    if (!connection?.id) {
      return response.status(400).json({ error: "Conexao ML nao encontrada." });
    }

    const validConnection = await ensureValidAccessToken(connection);
    const result = await syncLeadsToWebsite(
      validConnection.access_token,
      String(validConnection.seller_id)
    );

    return response.status(200).json(result);
  } catch (error) {
    log.error("Sync leads falhou", error instanceof Error ? error : new Error(String(error)));
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
