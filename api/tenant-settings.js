/**
 * API: /api/tenant-settings
 *
 * Gerencia configurações de branding por tenant (profile_id).
 * Permite que cada conta configure nome da empresa, logo, cor primária
 * e texto de rodapé das etiquetas internas.
 *
 * GET  /api/tenant-settings          → retorna as configurações do perfil autenticado
 * POST /api/tenant-settings          → salva/atualiza as configurações (admin only)
 */

import { db } from "./_lib/db.js";
import {
  getAuthenticatedProfile,
  parseRequestBody,
} from "./_lib/auth-server.js";

// Sanitiza uma string de cor hex (#rrggbb ou #rgb).
function sanitizeColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return null;
}

// Sanitiza uma URL: aceita strings que começam com /, http:// ou https://.
function sanitizeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/^(https?:\/\/|\/)/.test(trimmed)) return trimmed.slice(0, 512);
  return null;
}

function sanitizeText(value, maxLen = 200) {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLen);
}

function getSettingsForProfile(profileId) {
  return db
    .prepare(
      `SELECT company_name, logo_url, primary_color, label_footer, updated_at
         FROM tenant_settings
        WHERE profile_id = ?`
    )
    .get(profileId) ?? null;
}

function upsertSettings(profileId, { company_name, logo_url, primary_color, label_footer }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tenant_settings (profile_id, company_name, logo_url, primary_color, label_footer, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
          company_name  = excluded.company_name,
          logo_url      = excluded.logo_url,
          primary_color = excluded.primary_color,
          label_footer  = excluded.label_footer,
          updated_at    = excluded.updated_at`
  ).run(profileId, company_name, logo_url, primary_color, label_footer, now);
}

export default async function tenantSettingsHandler(req, res) {
  try {
    const { authUser, profile } = await getAuthenticatedProfile(req);
    if (!authUser || !profile || !profile.active) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    // GET — retorna configurações do perfil autenticado
    if (req.method === "GET") {
      const settings = getSettingsForProfile(profile.id);
      return res.status(200).json({
        ok: true,
        settings: settings ?? {
          company_name: "",
          logo_url: "",
          primary_color: "#16a34a",
          label_footer: "",
          updated_at: null,
        },
      });
    }

    // POST — salva configurações (admin only)
    if (req.method === "POST") {
      if (profile.role !== "admin") {
        return res.status(403).json({ error: "forbidden" });
      }

      const body = await parseRequestBody(req);

      const company_name = sanitizeText(body?.company_name, 200);
      if (company_name === null) {
        return res.status(400).json({ error: "company_name_invalid" });
      }

      const logo_url = sanitizeUrl(body?.logo_url);
      if (logo_url === null) {
        return res.status(400).json({ error: "logo_url_invalid" });
      }

      const primary_color = sanitizeColor(body?.primary_color) ?? "#16a34a";

      const label_footer = sanitizeText(body?.label_footer, 200) ?? "";

      upsertSettings(profile.id, { company_name, logo_url, primary_color, label_footer });

      const saved = getSettingsForProfile(profile.id);
      return res.status(200).json({ ok: true, settings: saved });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("[tenant-settings] erro:", err?.message ?? err);
    return res.status(500).json({ error: "internal_error" });
  }
}
