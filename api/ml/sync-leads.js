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
import { db } from "../_lib/db.js";
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
  const { data: existingLeads, error: fetchErr } = await supabase
    .from("leads")
    .select("metadata")
    .order("created_at", { ascending: false })
    .limit(500);

  const existingQuestionIds = new Set();
  for (const lead of existingLeads || []) {
    const qid = lead.metadata?.ml_question_id;
    if (qid != null && qid !== "") existingQuestionIds.add(String(qid));
  }

  log.info(`Dedup: ${existingQuestionIds.size} question IDs ja existem no Supabase`);

  // 3. Inserir novos leads
  let inserted = 0;
  let skipped = 0;
  const errors = [];
  const seenIds = new Set();

  for (const question of allQuestions) {
    const qid = question.id;

    // Dedup: pular se id invalido, ja existe no DB, ou ja processado neste batch
    if (qid == null) {
      skipped++;
      continue;
    }
    const qidStr = String(qid);
    if (existingQuestionIds.has(qidStr) || seenIds.has(qidStr)) {
      skipped++;
      continue;
    }
    seenIds.add(qidStr);

    // Buscar info do comprador e do item (em paralelo)
    const [buyerInfo, itemTitle] = await Promise.all([
      fetchBuyerInfo(token, question.from?.id),
      fetchItemTitle(token, question.item_id),
    ]);

    const lead = mapQuestionToLead(question, buyerInfo, itemTitle);

    const { error } = await supabase.from("leads").insert(lead);
    if (error) {
      errors.push({ question_id: qid, error: error.message });
      log.error(`Insert lead falhou (q=${qid}): ${error.message}`);
    } else {
      inserted++;
      existingQuestionIds.add(qidStr);
    }
  }

  return {
    success: true,
    supabase_existing: existingLeads?.length || 0,
    supabase_fetch_error: fetchErr?.message || null,
    dedup_ids_count: existingQuestionIds.size - inserted,
    sample_question_id: allQuestions[0]?.id ?? "NO_ID",
    ml_unanswered: unanswered.total,
    ml_answered: answered.total,
    fetched: allQuestions.length,
    inserted,
    skipped,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  };
}

// ── Sync compradores dos pedidos como leads ─────────────────────
// Extrai dados reais (nome, CPF, endereço) do billing_info dos pedidos
// e insere como leads com source='other'. Esses dados vêm das etiquetas.
async function syncBuyersAsLeads(connectionId, token, supabase) {
  const rows = db.prepare(`
    SELECT DISTINCT order_id, buyer_name, buyer_nickname, raw_data
    FROM ml_orders
    WHERE connection_id = ?
      AND raw_data IS NOT NULL
      AND json_extract(raw_data, '$.billing_info_snapshot.buyer.billing_info.name') IS NOT NULL
    GROUP BY buyer_nickname
    ORDER BY sale_date DESC
    LIMIT 300
  `).all(connectionId);

  if (rows.length === 0) return { buyers_fetched: 0, buyers_inserted: 0, buyers_skipped: 0 };

  // Dedup contra leads existentes por nome
  const { data: existingLeads } = await supabase
    .from("leads")
    .select("name, metadata")
    .limit(2000);

  const existingNames = new Set(
    (existingLeads || []).map(l => l.name?.toLowerCase()).filter(Boolean)
  );
  const existingBuyerIds = new Set(
    (existingLeads || []).map(l => l.metadata?.ml_buyer_id).filter(Boolean)
  );

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    let rawData = {};
    try {
      rawData = typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data || {};
    } catch { continue; }

    const billing = rawData.billing_info_snapshot?.buyer?.billing_info || {};
    const addr = billing.address || {};
    const ident = billing.identification || {};
    const buyerId = rawData.billing_info_snapshot?.buyer?.cust_id;

    const firstName = (billing.name || "").trim();
    const lastName = (billing.last_name || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || row.buyer_name;

    if (!fullName) { skipped++; continue; }
    if (existingNames.has(fullName.toLowerCase())) { skipped++; continue; }
    if (buyerId && existingBuyerIds.has(String(buyerId))) { skipped++; continue; }

    const cpf = ident.number ? String(ident.number).trim() : null;
    const city = addr.city_name || "";
    const state = addr.state_name || addr.state || "";

    const lead = {
      name: fullName,
      source: "other",
      message: `Comprador ML — ${cpf ? (ident.type || "CPF") + ": " + cpf : ""}${city ? " | " + city + "/" + state : ""}`,
      status: "new",
      consent: false,
      metadata: {
        ml_buyer_id: buyerId ? String(buyerId) : null,
        ml_order_id: row.order_id,
        cpf_cnpj: cpf,
        doc_type: ident.type || null,
        address: addr.street_name ? `${addr.street_name}, ${addr.street_number || ""} - ${addr.neighborhood || ""}, ${city}/${state} ${addr.zip_code || ""}` : null,
      },
    };

    const { error } = await supabase.from("leads").insert(lead);
    if (!error) {
      inserted++;
      existingNames.add(fullName.toLowerCase());
      if (buyerId) existingBuyerIds.add(String(buyerId));
    }
  }

  return { buyers_fetched: rows.length, buyers_inserted: inserted, buyers_skipped: skipped };
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

    // Sync perguntas (questions) + compradores (orders) como leads
    const questionsResult = await syncLeadsToWebsite(
      validConnection.access_token,
      String(validConnection.seller_id)
    );

    // Sync compradores dos pedidos como leads
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const buyersResult = await syncBuyersAsLeads(
      connection.id,
      validConnection.access_token,
      supabase
    );

    return response.status(200).json({
      ...questionsResult,
      ...buyersResult,
    });
  } catch (error) {
    log.error("Sync leads falhou", error instanceof Error ? error : new Error(String(error)));
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
