// ─── POST /api/ml/admin/sync-from-ml ───────────────────────────────────
//
// Endpoint que recebe dados do operations-dashboard do ML Seller Center
// enviados via extensão Chrome ou bookmarklet rodando no contexto do browser logado.
//
// A extensão Chrome faz fetch same-origin para o ML operations-dashboard,
// obtém os números exatos dos chips, e envia para cá via POST cross-origin.
//
// Body JSON aceita dois formatos:
//
// Formato 1 (extensão Chrome):
// {
//   username: string,
//   password: string,
//   connection_id?: string,
//   seller_id?: string,
//   counts: { today, upcoming, in_transit, finalized },
//   source?: string,
// }
//
// Formato 2 (bookmarklet legado):
// {
//   username: string,
//   password: string,
//   connection_id?: string,
//   tabs: object (resposta do operations-dashboard/tabs),
// }
//
// CORS: aberto para qualquer origin (necessário para extensão/bookmarklet no ML)
// Auth: via username/password no body (não via cookie, pois é cross-origin)
//
import { authenticateUser } from "../../_lib/auth-server.js";
import { injectLiveSnapshotCounters } from "../_lib/seller-center-scraper.js";

export default async function handler(request, response) {
  // ── CORS headers (necessário para fetch cross-origin) ──
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ success: false, error: "Use POST." });
  }

  const body = request.body;
  if (!body || typeof body !== "object") {
    return response.status(400).json({
      success: false,
      error: "Body deve ser JSON.",
    });
  }

  // ── Auth via body (não cookie) ──
  const { username, password } = body;
  if (!username || !password) {
    return response.status(401).json({
      success: false,
      error: "username e password são obrigatórios no body.",
    });
  }

  try {
    const fakeRes = { setHeader: () => {}, getHeader: () => null };
    const user = await authenticateUser(username, password, fakeRes, { skipCookie: true });
    if (!user || user.role !== "admin") {
      return response.status(403).json({
        success: false,
        error: "Credenciais inválidas ou usuário não é admin.",
      });
    }
  } catch (err) {
    return response.status(401).json({
      success: false,
      error: "Falha na autenticação: " + (err?.message || "unknown"),
    });
  }

  // ── Parse chip counts ──
  const { tabs, counts, connection_id, seller_id, source } = body;

  let today = 0, upcoming = 0, in_transit = 0, finalized = 0;

  if (counts && typeof counts === "object" && typeof counts.today === "number") {
    // Formato extensão Chrome: { counts: { today, upcoming, in_transit, finalized } }
    today = counts.today;
    upcoming = counts.upcoming || 0;
    in_transit = counts.in_transit || 0;
    finalized = counts.finalized || 0;
  } else if (tabs && typeof tabs === "object") {
    // Formato bookmarklet legado
    if (Array.isArray(tabs)) {
      for (const tab of tabs) {
        const id = String(tab.id || tab.filter || "").toUpperCase();
        const qty = Number(tab.quantity || tab.count || 0);
        if (id.includes("TODAY")) today = qty;
        else if (id.includes("NEXT") || id.includes("UPCOMING")) upcoming = qty;
        else if (id.includes("TRANSIT") || id.includes("SHIPPED") || id.includes("WAY")) in_transit = qty;
        else if (id.includes("FINAL") || id.includes("DELIVERED")) finalized = qty;
      }
    } else if (tabs.tabs && Array.isArray(tabs.tabs)) {
      for (const tab of tabs.tabs) {
        const id = String(tab.id || tab.filter || "").toUpperCase();
        const qty = Number(tab.quantity || tab.count || 0);
        if (id.includes("TODAY")) today = qty;
        else if (id.includes("NEXT") || id.includes("UPCOMING")) upcoming = qty;
        else if (id.includes("TRANSIT") || id.includes("SHIPPED") || id.includes("WAY")) in_transit = qty;
        else if (id.includes("FINAL") || id.includes("DELIVERED")) finalized = qty;
      }
    } else if (typeof tabs.today === "number") {
      today = tabs.today;
      upcoming = tabs.upcoming || 0;
      in_transit = tabs.in_transit || 0;
      finalized = tabs.finalized || 0;
    } else {
      return response.status(400).json({
        success: false,
        error: "Formato de 'tabs' não reconhecido. Use 'counts' ou 'tabs' com formato válido.",
        received_keys: Object.keys(tabs),
      });
    }
  } else {
    return response.status(400).json({
      success: false,
      error: "Campo 'counts' ou 'tabs' é obrigatório.",
    });
  }

  // Determinar connection_id
  // Prioridade: connection_id explícito > mapeamento por seller_id
  let resolvedConnectionId = connection_id
    ? String(connection_id).trim()
    : null;

  // Se não tem connection_id mas tem seller_id, tenta mapear
  if (!resolvedConnectionId && seller_id) {
    // Seller IDs conhecidos → connection_ids
    const SELLER_CONNECTION_MAP = {
      "688498964": "3c75e4e0-6e3a-4e36-8810-3b1395f72b04", // Fantom
      // Ecoferro (283073033) usa connection_id = null (default)
    };
    resolvedConnectionId = SELLER_CONNECTION_MAP[String(seller_id)] || null;
  }

  const result = injectLiveSnapshotCounters(
    { today, upcoming, in_transit, finalized },
    resolvedConnectionId
  );

  return response.status(200).json({
    success: true,
    injected: { today, upcoming, in_transit, finalized },
    connection_id: resolvedConnectionId || "default",
    seller_id: seller_id || null,
    source: source || "unknown",
    expires_in_seconds: result.ttlSeconds,
    message: "Chips sincronizados com sucesso.",
  });
}
