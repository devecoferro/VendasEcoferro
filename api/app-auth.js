import {
  authenticateUser,
  clearSessionCookie,
  getAuthenticatedProfile,
  parseRequestBody,
  revokeSessionByToken,
  serializeProfile,
} from "./_lib/auth-server.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseRequestBody(request);
    const action = body.action || "session";

    if (action === "login") {
      try {
        const user = await authenticateUser(body.username, body.password, response, {
          totpCode: body.totp_code || body.totpCode,
        });
        return response.status(200).json({ user });
      } catch (error) {
        // S9: 428 = TOTP required (cliente deve prompting pelo código)
        if (error?.code === "totp_required") {
          return response.status(428).json({
            error: error.message,
            code: "totp_required",
          });
        }
        if (error?.code === "totp_invalid") {
          return response.status(401).json({
            error: error.message,
            code: "totp_invalid",
          });
        }
        throw error;
      }
    }

    if (action === "logout") {
      const { sessionToken } = await getAuthenticatedProfile(request);
      if (sessionToken) {
        revokeSessionByToken(sessionToken);
      }

      clearSessionCookie(response);
      return response.status(200).json({ success: true });
    }

    if (action === "session") {
      const { profile } = await getAuthenticatedProfile(request);
      if (!profile) {
        clearSessionCookie(response);
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

