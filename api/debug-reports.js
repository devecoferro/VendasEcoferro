// ─── /api/debug-reports ──────────────────────────────────────────────
//
// Endpoints pra reports de bugs/sugestões/dúvidas dos usuários.
//
//   GET  /api/debug-reports              — lista (todos se admin, só seus se user)
//   GET  /api/debug-reports?id=X         — retorna 1 específico
//   POST /api/debug-reports              — cria novo (qualquer user autenticado)
//   PATCH /api/debug-reports?id=X        — atualiza status (admin only)
//   DELETE /api/debug-reports?id=X       — deleta (admin only)
//
// Schema do body POST:
//   {
//     type: 'bug' | 'suggestion' | 'question',
//     title: string,
//     description: string,
//     screen: string | null,
//     priority: 'low' | 'medium' | 'high',
//     screenshots: Array<dataUrl>   // data:image/png;base64,... (max 2MB cada)
//   }

import {
  requireAuthenticatedProfile,
  parseRequestBody,
} from "./_lib/auth-server.js";
import {
  createReport,
  listReports,
  updateReport,
  deleteReport,
  getReportsSummary,
} from "./_lib/debug-reports-store.js";

export default async function handler(request, response) {
  let profile;
  try {
    const auth = await requireAuthenticatedProfile(request);
    profile = auth.profile;
  } catch (error) {
    const status = error?.statusCode || 401;
    return response.status(status).json({
      success: false,
      error: error?.message || "Acesso negado.",
    });
  }

  const isAdmin = profile.role === "admin";
  const userId = profile.id;
  const method = request.method || "GET";
  const id = request.query?.id ? String(request.query.id) : null;

  try {
    // ── GET — lista ou específico, ou summary (admin only) ──
    if (method === "GET") {
      if (request.query?.summary === "1") {
        if (!isAdmin) {
          return response
            .status(403)
            .json({ success: false, error: "Apenas admin." });
        }
        return response.status(200).json({
          success: true,
          summary: getReportsSummary(),
        });
      }

      const status = request.query?.status
        ? String(request.query.status)
        : undefined;
      const type = request.query?.type ? String(request.query.type) : undefined;

      const reports = listReports({ userId, isAdmin, status, type });

      if (id) {
        const found = reports.find((r) => r.id === id);
        if (!found) {
          return response
            .status(404)
            .json({ success: false, error: "Report não encontrado." });
        }
        return response.status(200).json({ success: true, report: found });
      }

      return response.status(200).json({
        success: true,
        reports,
        count: reports.length,
        is_admin: isAdmin,
      });
    }

    // ── POST — criar novo report ──
    if (method === "POST") {
      const body = await parseRequestBody(request);
      if (!body || typeof body !== "object") {
        return response
          .status(400)
          .json({ success: false, error: "Body inválido." });
      }
      if (!body.title || !body.description) {
        return response.status(400).json({
          success: false,
          error: "Título e descrição são obrigatórios.",
        });
      }
      const created = createReport({
        userId,
        username: profile.username,
        type: body.type,
        title: body.title,
        description: body.description,
        screen: body.screen,
        priority: body.priority,
        screenshotsDataUrls: Array.isArray(body.screenshots)
          ? body.screenshots
          : [],
      });
      return response.status(201).json({ success: true, report: created });
    }

    // ── PATCH — atualiza status (admin) ──
    if (method === "PATCH" || method === "PUT") {
      if (!id) {
        return response
          .status(400)
          .json({ success: false, error: "?id obrigatório." });
      }
      const body = await parseRequestBody(request);
      const updated = updateReport(id, body || {}, { isAdmin });
      return response.status(200).json({ success: true, report: updated });
    }

    // ── DELETE — deleta (admin) ──
    if (method === "DELETE") {
      if (!id) {
        return response
          .status(400)
          .json({ success: false, error: "?id obrigatório." });
      }
      const result = deleteReport(id, { isAdmin });
      return response.status(200).json({ success: true, ...result });
    }

    response.setHeader("Allow", "GET, POST, PATCH, PUT, DELETE");
    return response.status(405).json({ success: false, error: "Método não permitido." });
  } catch (error) {
    const status = error?.statusCode || 500;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Erro interno." });
  }
}
