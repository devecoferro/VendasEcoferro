/**
 * API: /api/label-templates
 *
 * Gerencia templates de etiqueta por tenant (profile_id).
 * Cada template define o layout JSON com campos, posições, fontes e dimensões.
 *
 * GET    /api/label-templates          → lista templates do perfil autenticado
 * POST   /api/label-templates          → cria novo template (admin only)
 * PUT    /api/label-templates/:id      → atualiza template existente (admin only)
 * DELETE /api/label-templates/:id      → remove template (admin only)
 * POST   /api/label-templates/:id/set-default → define como template padrão (admin only)
 */

import { db } from "./_lib/db.js";
import {
  getAuthenticatedProfile,
  parseRequestBody,
} from "./_lib/auth-server.js";

// Layout padrão da etiqueta Ecoferro (espelha o pdfExportService.ts atual).
// Usado como base quando um novo tenant cria seu primeiro template.
export const DEFAULT_LABEL_LAYOUT = {
  card_width_mm: 194,
  card_height_mm: 53,
  border_color: "#f97316",
  border_radius_mm: 2.5,
  border_width_mm: 0.7,
  fields: [
    {
      id: "ml_logo",
      type: "logo",
      label: "Logo Mercado Livre",
      source: "static.ml_logo",
      x: 12, y: 3, width: 27, height: 8,
      visible: true,
    },
    {
      id: "product_image",
      type: "image",
      label: "Foto do produto",
      source: "item.productImageUrl",
      x: 8, y: 13, width: 31, height: 32,
      visible: true,
    },
    {
      id: "sku",
      type: "text",
      label: "SKU",
      source: "item.sku",
      x: 45, y: 6,
      font_size: 10, font_weight: "bold",
      prefix: "SKU: ",
      visible: true,
    },
    {
      id: "title",
      type: "text",
      label: "Título do produto",
      source: "item.title",
      x: 45, y: 11,
      font_size: 7, font_weight: "normal",
      max_width_mm: 50,
      visible: true,
    },
    {
      id: "buyer_name",
      type: "text",
      label: "Nome do comprador",
      source: "sale.buyerName",
      x: 45, y: 15,
      font_size: 7, font_weight: "bold",
      max_width_mm: 50,
      visible: true,
    },
    {
      id: "buyer_nickname",
      type: "text",
      label: "Nickname ML",
      source: "sale.buyerNickname",
      x: 45, y: 18.5,
      font_size: 7, font_weight: "normal",
      prefix: "@",
      visible: true,
    },
    {
      id: "quantity",
      type: "text",
      label: "Quantidade",
      source: "item.quantity",
      x: 45, y: 24,
      font_size: 7, font_weight: "normal",
      prefix: "Qtd: ",
      visible: true,
    },
    {
      id: "sale_qr",
      type: "qr",
      label: "QR Venda",
      source: "sale.saleNumber",
      x: 56, y: 3, width: 18, height: 18,
      visible: true,
    },
    {
      id: "tenant_logo",
      type: "logo",
      label: "Logo da empresa",
      source: "tenant.logo_url",
      x: 75, y: 3, width: 18, height: 8,
      visible: true,
    },
    {
      id: "location_corridor",
      type: "text",
      label: "Corredor",
      source: "item.corridor",
      x: 99, y: 6,
      font_size: 7, font_weight: "bold",
      prefix: "Corredor: ",
      visible: true,
    },
    {
      id: "location_shelf",
      type: "text",
      label: "Estante",
      source: "item.shelf",
      x: 99, y: 11,
      font_size: 7, font_weight: "normal",
      prefix: "Estante: ",
      visible: true,
    },
    {
      id: "location_level",
      type: "text",
      label: "Nível",
      source: "item.level",
      x: 99, y: 15,
      font_size: 7, font_weight: "normal",
      prefix: "Nível: ",
      visible: true,
    },
    {
      id: "object_qr",
      type: "qr",
      label: "QR Objeto (Rastreio)",
      source: "sale.shippingId",
      x: 156, y: 3, width: 30, height: 30,
      visible: true,
    },
    {
      id: "sale_number_footer",
      type: "text",
      label: "Número da venda (rodapé)",
      source: "sale.saleNumber",
      x: 6, y: 50,
      font_size: 7, font_weight: "normal",
      prefix: "#",
      visible: true,
    },
    {
      id: "label_footer",
      type: "text",
      label: "Rodapé customizado",
      source: "tenant.label_footer",
      x: 99, y: 50,
      font_size: 6, font_weight: "normal",
      visible: true,
    },
  ],
};

function getTemplatesForProfile(profileId) {
  return db
    .prepare(
      `SELECT id, profile_id, name, is_default, layout_json, created_at, updated_at
         FROM label_templates
        WHERE profile_id = ?
        ORDER BY is_default DESC, created_at ASC`
    )
    .all(profileId)
    .map((row) => ({
      ...row,
      layout_json: (() => {
        try { return JSON.parse(row.layout_json); } catch { return {}; }
      })(),
    }));
}

function getTemplateById(id, profileId) {
  const row = db
    .prepare(
      `SELECT id, profile_id, name, is_default, layout_json, created_at, updated_at
         FROM label_templates
        WHERE id = ? AND profile_id = ?`
    )
    .get(id, profileId);
  if (!row) return null;
  return {
    ...row,
    layout_json: (() => {
      try { return JSON.parse(row.layout_json); } catch { return {}; }
    })(),
  };
}

function createTemplate(profileId, { name, layout_json, is_default = 0 }) {
  const now = new Date().toISOString();
  const layoutStr = typeof layout_json === "string"
    ? layout_json
    : JSON.stringify(layout_json);
  const result = db
    .prepare(
      `INSERT INTO label_templates (profile_id, name, is_default, layout_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(profileId, name, is_default ? 1 : 0, layoutStr, now, now);
  return result.lastInsertRowid;
}

function updateTemplate(id, profileId, { name, layout_json, is_default }) {
  const now = new Date().toISOString();
  const layoutStr = layout_json !== undefined
    ? (typeof layout_json === "string" ? layout_json : JSON.stringify(layout_json))
    : undefined;
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push("name = ?"); params.push(name); }
  if (layoutStr !== undefined) { fields.push("layout_json = ?"); params.push(layoutStr); }
  if (is_default !== undefined) { fields.push("is_default = ?"); params.push(is_default ? 1 : 0); }
  if (fields.length === 0) return false;
  fields.push("updated_at = ?");
  params.push(now, id, profileId);
  db.prepare(
    `UPDATE label_templates SET ${fields.join(", ")} WHERE id = ? AND profile_id = ?`
  ).run(...params);
  return true;
}

function setDefaultTemplate(id, profileId) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE label_templates SET is_default = 0, updated_at = ? WHERE profile_id = ?`
    ).run(now, profileId);
    db.prepare(
      `UPDATE label_templates SET is_default = 1, updated_at = ? WHERE id = ? AND profile_id = ?`
    ).run(now, id, profileId);
  })();
}

function deleteTemplate(id, profileId) {
  db.prepare(
    `DELETE FROM label_templates WHERE id = ? AND profile_id = ?`
  ).run(id, profileId);
}

function sanitizeTemplateName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 100);
  return trimmed.length > 0 ? trimmed : null;
}

export default async function labelTemplatesHandler(req, res) {
  try {
    const { authUser, profile } = await getAuthenticatedProfile(req);
    if (!authUser || !profile || !profile.active) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    const urlParts = req.path.replace(/^\/api\/label-templates\/?/, "").split("/");
    const templateId = urlParts[0] ? Number(urlParts[0]) : null;
    const action = urlParts[1] || null; // ex: "set-default"

    // GET /api/label-templates — lista todos os templates do perfil
    if (req.method === "GET" && !templateId) {
      const templates = getTemplatesForProfile(profile.id);
      // Se não há templates, retorna o padrão como sugestão (não persiste)
      if (templates.length === 0) {
        return res.status(200).json({
          ok: true,
          templates: [],
          default_layout: DEFAULT_LABEL_LAYOUT,
        });
      }
      return res.status(200).json({ ok: true, templates });
    }

    // GET /api/label-templates/:id — retorna template específico
    if (req.method === "GET" && templateId) {
      const template = getTemplateById(templateId, profile.id);
      if (!template) return res.status(404).json({ error: "not_found" });
      return res.status(200).json({ ok: true, template });
    }

    // Operações de escrita — admin only
    if (profile.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    // POST /api/label-templates — cria novo template
    if (req.method === "POST" && !templateId) {
      const body = await parseRequestBody(req);
      const name = sanitizeTemplateName(body?.name) ?? "Novo template";
      const layout_json = body?.layout_json ?? DEFAULT_LABEL_LAYOUT;
      const is_default = Boolean(body?.is_default);
      const newId = createTemplate(profile.id, { name, layout_json, is_default });
      if (is_default) setDefaultTemplate(newId, profile.id);
      const created = getTemplateById(newId, profile.id);
      return res.status(201).json({ ok: true, template: created });
    }

    // POST /api/label-templates/:id/set-default — define como padrão
    if (req.method === "POST" && templateId && action === "set-default") {
      const existing = getTemplateById(templateId, profile.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      setDefaultTemplate(templateId, profile.id);
      return res.status(200).json({ ok: true });
    }

    // PUT /api/label-templates/:id — atualiza template
    if (req.method === "PUT" && templateId) {
      const existing = getTemplateById(templateId, profile.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const body = await parseRequestBody(req);
      const name = body?.name !== undefined ? sanitizeTemplateName(body.name) : undefined;
      const layout_json = body?.layout_json;
      const is_default = body?.is_default !== undefined ? Boolean(body.is_default) : undefined;
      updateTemplate(templateId, profile.id, { name, layout_json, is_default });
      if (is_default) setDefaultTemplate(templateId, profile.id);
      const updated = getTemplateById(templateId, profile.id);
      return res.status(200).json({ ok: true, template: updated });
    }

    // DELETE /api/label-templates/:id — remove template
    if (req.method === "DELETE" && templateId) {
      const existing = getTemplateById(templateId, profile.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      deleteTemplate(templateId, profile.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("[label-templates] erro:", err?.message ?? err);
    return res.status(500).json({ error: "internal_error" });
  }
}
