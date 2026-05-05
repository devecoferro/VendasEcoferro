// ─── POST /api/ml/admin/inject-chip-counts ─────────────────────────────
//
// Endpoint admin que permite injetar manualmente os counters dos chips
// do ML Seller Center diretamente no cache do live-snapshot.
//
// Útil quando o scraper Playwright não está configurado ou os cookies
// expiraram, mas os números corretos são conhecidos (ex: lidos da UI
// do ML via browser).
//
// Body JSON: { today: number, upcoming: number, in_transit: number, finalized: number }
// Query: ?connection_id=XXX (opcional, default = conta principal)
//
// O cache injetado dura 10 minutos (vs 2min do scraper normal),
// dando tempo para o scraper ser reconfigurado.

import { requireAdmin } from "../../_lib/auth-server.js";
import { injectLiveSnapshotCounters } from "../_lib/seller-center-scraper.js";

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    return response
      .status(error?.statusCode || 401)
      .json({ success: false, error: error?.message || "Acesso negado." });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false, error: "Use POST." });
  }

  const connectionId = request.query?.connection_id
    ? String(request.query.connection_id).trim()
    : null;

  const body = request.body;
  if (!body || typeof body !== "object") {
    return response.status(400).json({
      success: false,
      error: "Body deve ser JSON com { today, upcoming, in_transit, finalized }.",
    });
  }

  const today = Number(body.today);
  const upcoming = Number(body.upcoming);
  const in_transit = Number(body.in_transit);
  const finalized = Number(body.finalized);

  if (![today, upcoming, in_transit, finalized].every(Number.isFinite)) {
    return response.status(400).json({
      success: false,
      error: "Todos os campos devem ser números válidos.",
    });
  }

  const result = injectLiveSnapshotCounters(
    { today, upcoming, in_transit, finalized },
    connectionId
  );

  return response.status(200).json({
    success: true,
    injected: { today, upcoming, in_transit, finalized },
    connection_id: connectionId || "default",
    expires_in_seconds: result.ttlSeconds,
    message: "Counters injetados no cache do live-snapshot com sucesso.",
  });
}
