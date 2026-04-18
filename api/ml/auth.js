import {
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
  ensureMercadoLivreCredentials,
} from "./_lib/app-config.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  deleteConnection,
  getLatestConnection,
  upsertConnection,
} from "./_lib/storage.js";
import { refreshMercadoLivreToken } from "./_lib/mercado-livre.js";

function sanitizeConnection(connection) {
  if (!connection) return null;

  return {
    id: connection.id,
    seller_id: connection.seller_id,
    seller_nickname: connection.seller_nickname,
    last_sync_at: connection.last_sync_at,
    token_expires_at: connection.token_expires_at,
    created_at: connection.created_at,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const body =
      typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const {
      action,
      code,
      redirect_uri,
      state,
      connection_id,
      code_verifier,
      code_challenge,
      code_challenge_method,
    } = body;

    if (action === "status") {
      return response.status(200).json({
        connection: sanitizeConnection(getLatestConnection()),
      });
    }

    if (action === "disconnect") {
      if (!connection_id) {
        return response.status(400).json({ error: "connection_id is required" });
      }

      deleteConnection(connection_id);
      return response.status(200).json({ success: true });
    }

    if (action === "refresh_token") {
      if (!connection_id) {
        return response.status(400).json({ error: "connection_id is required" });
      }

      const refreshedConnection = await refreshMercadoLivreToken(connection_id);
      return response.status(200).json({
        success: true,
        connection: sanitizeConnection(refreshedConnection),
      });
    }

    ensureMercadoLivreCredentials();

    if (action === "get_auth_url") {
      if (!redirect_uri || !state) {
        return response.status(400).json({ error: "redirect_uri and state are required" });
      }

      const authParams = new URLSearchParams({
        response_type: "code",
        client_id: ML_CLIENT_ID,
        redirect_uri,
        state,
      });

      if (code_challenge) {
        authParams.set("code_challenge", code_challenge);
        authParams.set("code_challenge_method", code_challenge_method || "S256");
      }

      return response.status(200).json({
        url: `https://auth.mercadolivre.com.br/authorization?${authParams.toString()}`,
      });
    }

    if (action === "exchange_code") {
      if (!code || !redirect_uri) {
        return response.status(400).json({ error: "code and redirect_uri are required" });
      }

      const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ML_CLIENT_ID,
          client_secret: ML_CLIENT_SECRET,
          code,
          redirect_uri,
          ...(code_verifier ? { code_verifier } : {}),
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const details = await tokenResponse.text();
        return response.status(tokenResponse.status).json({
          error: "Token exchange failed",
          details,
        });
      }

      const tokenData = await tokenResponse.json();

      // Validação explícita do payload do ML: user_id, access_token e
      // expires_in devem estar presentes. Sem isso, strings "undefined"
      // podiam ir pro DB em caso de payload malformado.
      if (
        !tokenData ||
        typeof tokenData.user_id !== "number" ||
        typeof tokenData.access_token !== "string" ||
        !tokenData.access_token ||
        typeof tokenData.refresh_token !== "string" ||
        !tokenData.refresh_token ||
        typeof tokenData.expires_in !== "number" ||
        !Number.isFinite(tokenData.expires_in)
      ) {
        return response.status(502).json({
          error: "ML returned malformed token payload",
        });
      }

      const userResponse = await fetch(
        `https://api.mercadolibre.com/users/${encodeURIComponent(String(tokenData.user_id))}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        }
      );
      const userData = userResponse.ok ? await userResponse.json() : { nickname: null };

      const storedConnection = upsertConnection({
        seller_id: String(tokenData.user_id),
        seller_nickname: userData.nickname || null,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      });

      return response.status(200).json({
        success: true,
        connection: sanitizeConnection(storedConnection),
      });
    }

    return response.status(400).json({ error: "Unknown action" });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
