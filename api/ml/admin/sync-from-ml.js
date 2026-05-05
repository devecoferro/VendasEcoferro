// ─── POST /api/ml/admin/sync-from-ml ───────────────────────────────────
//
// Endpoint que recebe dados do operations-dashboard do ML Seller Center
// enviados via bookmarklet/extensão rodando no contexto do browser logado.
//
// O bookmarklet faz fetch same-origin para o ML operations-dashboard,
// obtém os números exatos dos chips, e envia para cá via POST cross-origin.
//
// Body JSON: {
//   username: string,       — credencial admin do VendasEcoferro
//   password: string,       — credencial admin do VendasEcoferro
//   connection_id?: string, — ID da conexão (null = conta principal)
//   tabs: object,           — resposta do operations-dashboard/tabs
// }
//
// CORS: aberto para qualquer origin (necessário para bookmarklet no ML)
// Auth: via username/password no body (não via cookie, pois é cross-origin)
//
import { authenticateUser, getProfileByUsername } from "../../_lib/auth-server.js";
import { injectLiveSnapshotCounters } from "../_lib/seller-center-scraper.js";

export default async function handler(request, response) {
  // ── CORS headers (necessário para fetch cross-origin do bookmarklet) ──
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
    // authenticateUser valida credenciais e retorna o perfil.
    // Passamos response como null-like object pois não queremos setar cookie.
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

  // ── Parse operations-dashboard tabs response ──
  const { tabs, connection_id } = body;
  if (!tabs || typeof tabs !== "object") {
    return response.status(400).json({
      success: false,
      error: "Campo 'tabs' é obrigatório (resposta do operations-dashboard/tabs).",
    });
  }

  // O operations-dashboard/tabs retorna um array de objetos com:
  // { id: "TAB_TODAY", quantity: 88 }, { id: "TAB_NEXT_DAYS", quantity: 52 }, etc.
  let today = 0, upcoming = 0, in_transit = 0, finalized = 0;

  if (Array.isArray(tabs)) {
    // Formato array direto
    for (const tab of tabs) {
      const id = tab.id || tab.filter || "";
      const qty = Number(tab.quantity || tab.count || 0);
      if (id.includes("TODAY")) today = qty;
      else if (id.includes("NEXT") || id.includes("UPCOMING")) upcoming = qty;
      else if (id.includes("TRANSIT") || id.includes("SHIPPED")) in_transit = qty;
      else if (id.includes("FINAL") || id.includes("DELIVERED")) finalized = qty;
    }
  } else if (tabs.tabs && Array.isArray(tabs.tabs)) {
    // Formato { tabs: [...] }
    for (const tab of tabs.tabs) {
      const id = tab.id || tab.filter || "";
      const qty = Number(tab.quantity || tab.count || 0);
      if (id.includes("TODAY")) today = qty;
      else if (id.includes("NEXT") || id.includes("UPCOMING")) upcoming = qty;
      else if (id.includes("TRANSIT") || id.includes("SHIPPED")) in_transit = qty;
      else if (id.includes("FINAL") || id.includes("DELIVERED")) finalized = qty;
    }
  } else if (typeof tabs.today === "number") {
    // Formato direto { today, upcoming, in_transit, finalized }
    today = tabs.today;
    upcoming = tabs.upcoming || 0;
    in_transit = tabs.in_transit || 0;
    finalized = tabs.finalized || 0;
  } else {
    return response.status(400).json({
      success: false,
      error: "Formato de 'tabs' não reconhecido. Esperado array de {id, quantity} ou {today, upcoming, in_transit, finalized}.",
      received_keys: Object.keys(tabs),
    });
  }

  const connectionId = connection_id
    ? String(connection_id).trim()
    : null;

  const result = injectLiveSnapshotCounters(
    { today, upcoming, in_transit, finalized },
    connectionId
  );

  return response.status(200).json({
    success: true,
    injected: { today, upcoming, in_transit, finalized },
    connection_id: connectionId || "default",
    expires_in_seconds: result.ttlSeconds,
    message: "Chips sincronizados com sucesso via operations-dashboard.",
  });
}
