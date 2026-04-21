// ─── GET /api/ml/live-snapshot ────────────────────────────────────────
//
// Endpoint que retorna snapshot LIVE do Mercado Livre Seller Center
// (dados 1:1 com o que o ML mostra). Usado pela Fase 2 do frontend
// pra substituir a classificacao local (que divergia dos numeros do ML)
// por dados reais vindos direto da UI do ML via scraping.
//
// Retorna:
//   {
//     success: true,
//     from_cache: boolean,
//     stale: boolean,
//     captured_at: ISO,
//     counters: { today, upcoming, in_transit, finalized },
//     sub_cards: { today: {...}, upcoming: {...}, in_transit: {...}, finalized: {...} },
//     orders: {
//       today:     [{ pack_id, order_id, status_text, buyer_name, ... }],
//       upcoming:  [...],
//       in_transit: [...],
//       finalized: [...]
//     },
//     stats: { total_orders, tabs_with_data, xhr_count }
//   }
//
// Usage:
//   GET /api/ml/live-snapshot           — retorna cache (ou null se vazio)
//   GET /api/ml/live-snapshot?run=1     — forca scrape fresh (demora 30-60s)

import { requireAdmin } from "../_lib/auth-server.js";
import {
  scrapeMlLiveSnapshot,
  getCachedLiveSnapshot,
  isScraperConfigured,
  getLastScraperError,
  maybeRefreshLiveSnapshotInBackground,
  isLiveSnapshotScrapeInProgress,
} from "./_lib/seller-center-scraper.js";

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Acesso negado." });
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ success: false, error: "Use GET." });
  }

  if (!isScraperConfigured()) {
    return response.status(409).json({
      success: false,
      error:
        "Scraper nao configurado. Faca upload do storage state via /api/ml/admin/upload-scraper-state.",
      last_error: getLastScraperError(),
    });
  }

  const forceRun = request.query?.run === "1" || request.query?.run === "true";

  // Tenta cache primeiro (a menos que force)
  if (!forceRun) {
    const cached = getCachedLiveSnapshot();
    if (cached) {
      // AUTO-REFRESH em background: se cache está stale, dispara scrape
      // novo em background (single-flight — só 1 por vez). Cliente
      // recebe cache stale imediato e próxima request (30s depois,
      // do polling automático) já pega dados frescos.
      let bgRefresh = null;
      if (cached.stale === true) {
        bgRefresh = maybeRefreshLiveSnapshotInBackground();
      }
      return response.status(200).json({
        success: true,
        from_cache: true,
        stale: cached.stale === true,
        scrape_in_progress: isLiveSnapshotScrapeInProgress(),
        background_refresh: bgRefresh,
        captured_at: cached.capturedAt,
        ...cached.data,
      });
    }
    // Sem cache algum → dispara scrape em background e retorna 202
    // (Accepted — cliente deve fazer polling). Evita que o primeiro
    // usuario do dia trave 90s esperando.
    if (!isLiveSnapshotScrapeInProgress()) {
      maybeRefreshLiveSnapshotInBackground();
    }
    return response.status(202).json({
      success: true,
      from_cache: false,
      stale: false,
      scrape_in_progress: true,
      message: "Sem cache. Scrape disparado em background — tente novamente em 60-90s.",
    });
  }

  // Scrape fresh (2 navegacoes sequenciais, pode levar ate 180s)
  const result = await scrapeMlLiveSnapshot({ timeoutMs: 180_000 });

  if (!result.ok) {
    return response.status(502).json({
      success: false,
      error: result.error || "scrape_failed",
      message: result.message || null,
    });
  }

  return response.status(200).json({
    success: true,
    from_cache: false,
    stale: false,
    ...result,
  });
}
