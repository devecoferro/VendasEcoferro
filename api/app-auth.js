import {
  buildLoginEmail,
  getAuthenticatedProfile,
  hasServiceRoleKey,
  normalizeUsername,
  parseRequestBody,
  serializeProfile,
} from "./_lib/auth-server.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseRequestBody(request);
    const action = body.action || "prepare_login";

    if (action === "prepare_login") {
      const username = normalizeUsername(body.username);

      if (!username) {
        return response.status(400).json({ error: "Informe um usuario valido." });
      }

      return response.status(200).json({
        loginEmail: buildLoginEmail(username),
      });
    }

    if (action === "session") {
      if (!hasServiceRoleKey()) {
        return response.status(503).json({
          error: "Backend de autenticacao ainda nao configurado no servidor.",
        });
      }

      const { profile } = await getAuthenticatedProfile(request);
      if (!profile) {
        return response.status(401).json({ error: "Sessao invalida." });
      }

      return response.status(200).json({
        user: serializeProfile(profile),
      });
    }

    return response.status(400).json({ error: "Unknown action" });
  } catch (error) {
    return response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
