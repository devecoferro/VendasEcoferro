// Sincroniza compradores do ML → Supabase customers (ecoferro.com.br/admin/clientes)
//
// Extrai dados reais dos compradores das etiquetas/pedidos ML:
// nome completo, CPF/CNPJ, endereço (via billing_info_snapshot).
//
// Tabela Supabase "customers":
//   id, user_id, name, email, phone, cpf_cnpj, company_name,
//   is_company, notes, created_at, updated_at
//
// Tabela Supabase "addresses":
//   id, customer_id, label, street, number, complement, neighborhood,
//   city, state, zip_code, country, is_default, created_at

import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { db } from "../_lib/db.js";
import { getLatestConnection } from "./_lib/storage.js";
import createLogger from "../_lib/logger.js";

const log = createLogger("sync-customers");

const SUPABASE_URL = "https://kxknhqywhobkrpnlutel.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function normalize(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

// Extrai dados do comprador do pedido ML
function extractBuyerFromOrder(order) {
  let rawData = {};
  try {
    rawData = typeof order.raw_data === "string"
      ? JSON.parse(order.raw_data)
      : order.raw_data || {};
  } catch { rawData = {}; }

  const billing = rawData.billing_info_snapshot?.buyer?.billing_info || {};
  const addr = billing.address || {};
  const ident = billing.identification || {};
  const ship = rawData.shipment_snapshot || {};

  const firstName = normalize(billing.name);
  const lastName = normalize(billing.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || normalize(order.buyer_name);

  if (!fullName) return null;

  const cpfCnpj = normalize(ident.number);
  const docType = normalize(ident.type);

  return {
    name: fullName,
    cpf_cnpj: cpfCnpj,
    is_company: docType === "CNPJ",
    company_name: docType === "CNPJ" ? fullName : null,
    notes: `Cliente Mercado Livre`,
    ml_buyer_id: normalize(rawData.billing_info_snapshot?.buyer?.cust_id),
    address: {
      street: normalize(addr.street_name),
      number: normalize(addr.street_number),
      neighborhood: normalize(addr.neighborhood),
      city: normalize(addr.city_name),
      state: normalize(addr.state_name || addr.state),
      zip_code: normalize(addr.zip_code),
      country: normalize(addr.country_id) || "BR",
    },
  };
}

async function syncCustomersToWebsite(connectionId) {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Buscar todos os pedidos do DB com billing_info
  const rows = db.prepare(`
    SELECT order_id, buyer_name, buyer_nickname, raw_data
    FROM ml_orders
    WHERE connection_id = ?
      AND raw_data IS NOT NULL
      AND json_extract(raw_data, '$.billing_info_snapshot.buyer.billing_info.name') IS NOT NULL
    GROUP BY buyer_nickname
    ORDER BY sale_date DESC
    LIMIT 500
  `).all(connectionId);

  if (rows.length === 0) {
    return { success: true, fetched: 0, inserted: 0, skipped: 0, message: "Nenhum pedido com dados de comprador." };
  }

  // 2. Buscar clientes existentes no Supabase por cpf_cnpj
  const { data: existingCustomers } = await supabase
    .from("customers")
    .select("id, cpf_cnpj, name")
    .limit(2000);

  const existingByCpf = new Map();
  const existingByName = new Set();
  for (const c of existingCustomers || []) {
    if (c.cpf_cnpj) existingByCpf.set(c.cpf_cnpj, c.id);
    if (c.name) existingByName.add(c.name.toLowerCase());
  }

  // 3. Extrair compradores únicos e inserir
  let inserted = 0;
  let skipped = 0;
  let addresses_added = 0;
  const errors = [];
  const seenCpfs = new Set();

  for (const row of rows) {
    try {
      const buyer = extractBuyerFromOrder(row);
      if (!buyer || !buyer.name) { skipped++; continue; }

      // Dedup por CPF ou nome
      if (buyer.cpf_cnpj) {
        if (existingByCpf.has(buyer.cpf_cnpj) || seenCpfs.has(buyer.cpf_cnpj)) {
          skipped++;
          continue;
        }
        seenCpfs.add(buyer.cpf_cnpj);
      } else if (existingByName.has(buyer.name.toLowerCase())) {
        skipped++;
        continue;
      }

      // Inserir cliente
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          name: buyer.name,
          cpf_cnpj: buyer.cpf_cnpj,
          is_company: buyer.is_company,
          company_name: buyer.company_name,
          notes: buyer.notes,
        })
        .select("id")
        .single();

      if (error) {
        errors.push({ name: buyer.name, error: error.message });
        continue;
      }

      inserted++;
      if (buyer.cpf_cnpj) existingByCpf.set(buyer.cpf_cnpj, created.id);
      existingByName.add(buyer.name.toLowerCase());

      // Inserir endereço se disponível
      const addr = buyer.address;
      if (created?.id && addr.street) {
        const { error: addrErr } = await supabase
          .from("addresses")
          .insert({
            customer_id: created.id,
            label: "Mercado Livre",
            street: addr.street,
            number: addr.number,
            neighborhood: addr.neighborhood,
            city: addr.city,
            state: addr.state,
            zip_code: addr.zip_code,
            country: addr.country,
            is_default: true,
          });

        if (!addrErr) addresses_added++;
      }
    } catch (e) {
      errors.push({ order: row.order_id, error: e.message });
    }
  }

  return {
    success: true,
    fetched: rows.length,
    inserted,
    skipped,
    addresses_added,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Use POST para sincronizar clientes." });
  }

  try {
    await requireAuthenticatedProfile(request);

    const connection = getLatestConnection();
    if (!connection?.id) {
      return response.status(400).json({ error: "Conexao ML nao encontrada." });
    }

    const result = await syncCustomersToWebsite(connection.id);
    return response.status(200).json(result);
  } catch (error) {
    log.error("Sync customers falhou", error instanceof Error ? error : new Error(String(error)));
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
