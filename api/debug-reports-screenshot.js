// ─── GET /api/debug-reports/screenshot?file=X ────────────────────────
//
// Serve o arquivo de screenshot armazenado pelo debug-reports-store.
// Requer auth. Admin pode ver todas; user normal pode ver só as
// screenshots de reports próprios (checagem por prefixo do filename).

import { requireAuthenticatedProfile } from "./_lib/auth-server.js";
import {
  readScreenshot,
  getScreenshotContentType,
} from "./_lib/debug-reports-store.js";
import { listReports } from "./_lib/debug-reports-store.js";

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

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ success: false, error: "Use GET." });
  }

  const filename = request.query?.file ? String(request.query.file) : null;
  if (!filename) {
    return response.status(400).json({ success: false, error: "?file obrigatório." });
  }

  const isAdmin = profile.role === "admin";

  // Autoriza: admin ve tudo, user ve so de reports proprios.
  if (!isAdmin) {
    const myReports = listReports({
      userId: profile.id,
      isAdmin: false,
    });
    const hasAccess = myReports.some((r) =>
      Array.isArray(r.screenshots) && r.screenshots.includes(filename)
    );
    if (!hasAccess) {
      return response
        .status(403)
        .json({ success: false, error: "Sem permissão pra ver esta imagem." });
    }
  }

  const buffer = readScreenshot(filename);
  if (!buffer) {
    return response.status(404).json({ success: false, error: "Arquivo não encontrado." });
  }

  response.setHeader("Content-Type", getScreenshotContentType(filename));
  response.setHeader("Cache-Control", "private, max-age=3600");
  return response.status(200).send(buffer);
}
