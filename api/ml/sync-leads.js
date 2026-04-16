// Sincroniza leads do Mercado Livre → Supabase (ecoferro.com.br/admin/leads)
//
// No ML, "leads" são compradores que fazem perguntas nos anúncios (questions API)
// ou que interagem via mensagens pós-venda. Cada pergunta com dados de contato
// é um lead potencial para o site da Ecoferro.
//
// Tabela Supabase "leads":
//   id (UUID PK), name (TEXT), email (TEXT), phone (TEXT),
//   source (lead_source ENUM), message (TEXT), status (TEXT default 'new'),
//   consent (BOOLEAN), metadata (JSONB), created_at (TIMESTAMPTZ)
//
// lead_source enum: 'newsletter','contact_form','quote_form','abandoned_cart','popup','whatsapp','other'

import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getLatestConnection } from "./_lib/storage.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("sync-leads");

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Buscar perguntas recentes (leads) da API ML ─────────────────
async function fetchMLQuestions(token, sellerId, { limit = 50, offset = 0, status = "UNANSWERED" } = {}) {
  const url = `https://api.mercadolibre.com/questions/search?seller_id=${sellerId}&status=${status}&sort_fields=date_created&sort_types=DESC&limit=${limit}&offset=${offset}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { questions: [], total: 0, error: resp.status };
  const data = await resp.json();
  return {
    questions: data.questions || [],
    total: data.total || 0,
  };
}

// ── Buscar dados do comprador (nome, email) ─────────────────────
async function fetchBuyerInfo(token, buyerId) {
  if (!buyerId) return null;
  try {
    const resp = await fetch(`https://api.mercadolibre.com/users/${buyerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      name: data.first_name && data.last_name
        ? `${data.first_name} ${data.last_name}`
        : data.nickname || null,
      nickname: data.nickname || null,
      email: data.email || null,
      phone: data.phone?.number || null,
    };
  } catch {
    return null;
  }
}

// ── Buscar info do item (título) ────────────────────────────────
async function fetchItemTitle(token, itemId) {
  if (!itemId) return null;
  try {
    const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}?attributes=title`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.title || null;
  } catch {
    return null;
  }
}

// ── Mapear pergunta ML → lead Supabase ──────────────────────────
function mapQuestionToLead(question, buyerInfo, itemTitle) {
  return {
    name: buyerInfo?.name || buyerInfo?.nickname || null,
    email: buyerInfo?.email || null,
    phone: buyerInfo?.phone || null,
    source: "other", // ML não está no enum, usa 'other'
    message: question.text
      ? `[ML] ${itemTitle ? itemTitle + " — " : ""}${question.text}`
      : `Pergunta no Mercado Livre${itemTitle ? ": " + itemTitle : ""}`,
    status: "new",
    consent: false,
    metadata: {
      ml_question_id: question.id,
      ml_item_id: question.item_id,
      ml_buyer_id: question.from?.id,
      ml_date: question.date_created,
      ml_status: question.status,
      item_title: itemTitle,
    },
    created_at: question.date_created || new Date().toISOString(),
  };
}

// ── Sync principal ──────────────────────────────────────────────
async function syncLeadsToWebsite(token, sellerId) {
  if (!SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY nao configurada. " +
      "Adicione no Coolify: Settings → Environment Variables."
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Buscar perguntas do ML (unanswered + answered recentes)
  const [unanswered, answered] = await Promise.all([
    fetchMLQuestions(token, sellerId, { limit: 50, status: "UNANSWERED" }),
    fetchMLQuestions(token, sellerId, { limit: 50, status: "ANSWERED" }),
  ]);

  const allQuestions = [...unanswered.questions, ...answered.questions];

  if (allQuestions.length === 0) {
    return {
      success: true,
      ml_unanswered: unanswered.total,
      ml_answered: answered.total,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      message: "Nenhuma pergunta encontrada na API do ML.",
    };
  }

  // 2. Buscar leads existentes no Supabase para dedup
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("metadata")
    .eq("source", "other")
    .order("created_at", { ascending: false })
    .limit(500);

  const existingQuestionIds = new Set();
  for (const lead of existingLeads || []) {
    const qid = lead.metadata?.ml_question_id;
    if (qid) existingQuestionIds.add(String(qid));
  }

  // 3. Inserir novos leads
  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (const question of allQuestions) {
    // Dedup por question_id
    if (existingQuestionIds.has(String(question.id))) {
      skipped++;
      continue;
    }

    // Buscar info do comprador e do item (em paralelo)
    const [buyerInfo, itemTitle] = await Promise.all([
      fetchBuyerInfo(token, question.from?.id),
      fetchItemTitle(token, question.item_id),
    ]);

    const lead = mapQuestionToLead(question, buyerInfo, itemTitle);

    const { error } = await supabase.from("leads").insert(lead);
    if (error) {
      errors.push({ question_id: question.id, error: error.message });
    } else {
      inserted++;
      existingQuestionIds.add(String(question.id));
    }
  }

  return {
    success: true,
    ml_unanswered: unanswered.total,
    ml_answered: answered.total,
    fetched: allQuestions.length,
    inserted,
    skipped,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
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
