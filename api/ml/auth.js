import {
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
  ensureMercadoLivreCredentials,
} from "./_lib/app-config.js";
import { APP_BASE_URL } from "../_lib/app-config.js";
import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import {
  deleteConnection,
  getLatestConnection,
  upsertConnection,
} from "./_lib/storage.js";
import { refreshMercadoLivreToken } from "./_lib/mercado-livre.js";
import createLogger from "../_lib/logger.js";

const logger = createLogger("ml-auth");

// ─── OAuth state store (sprint 2.1 — security audit) ─────────────────
// Bind server-side state <-> profile + redirect_uri, pra evitar que
// um atacante injete um state arbitrario e a gente aceite cegamente.
// Entradas expiram em 10 min (fluxo OAuth e segundos, 10min e folga).
const STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map();

function recordOauthState(state, profileId, redirectUri) {
  oauthStateStore.set(state, {
    createdAt: Date.now(),
    profileId: profileId || null,
    redirectUri,
  });
  // Cleanup oportunista — previne growth leak. Limita a 1000 entradas.
  if (oauthStateStore.size > 1000) {
    const cutoff = Date.now() - STATE_TTL_MS;
    for (const [key, entry] of oauthStateStore) {
      if (entry.createdAt < cutoff) oauthStateStore.delete(key);
    }
  }
}

function consumeOauthState(state) {
  const entry = oauthStateStore.get(state);
  if (!entry) return null;
  oauthStateStore.delete(state); // one-shot — previne replay
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry;
}

// Whitelist de origins aceitos para redirect_uri. Por padrao so aceita
// o proprio APP_BASE_URL; env ML_OAUTH_REDIRECT_ORIGINS pode adicionar
// outros (ex: "https://staging.ecoferro.com.br,http://localhost:5173").
function getAllowedRedirectOrigins() {
  const defaults = [APP_BASE_URL];
  const extra = (process.env.ML_OAUTH_REDIRECT_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...defaults, ...extra];
}

function isRedirectUriAllowed(uri) {
  if (typeof uri !== "string" || !uri) return false;
  try {
    const parsed = new URL(uri);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const allowed = getAllowedRedirectOrigins();
    return allowed.some((a) => {
      try {
        const ap = new URL(a);
        return origin === `${ap.protocol}//${ap.host}`;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

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
    const profile = await requireAuthenticatedProfile(request);

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

      // Sprint 2.1: redirect_uri whitelist — recusa origins nao
      // permitidos pra evitar desvio do code OAuth pra atacante.
      if (!isRedirectUriAllowed(redirect_uri)) {
        logger.warn("redirect_uri rejeitado (fora da whitelist)", {
          redirect_uri,
          route: "ml-auth/get_auth_url",
        });
        return response.status(400).json({ error: "redirect_uri not allowed" });
      }

      // Sprint 2.1: bind state server-side com o profileId. Na troca
      // do code, validamos que o state existe, nao expirou, e o
      // redirect_uri bate com o registrado.
      if (typeof state !== "string" || state.length < 16) {
        return response.status(400).json({ error: "state too short" });
      }
      recordOauthState(state, profile?.id || null, redirect_uri);

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

      // Sprint 2.1: valida redirect_uri + state server-side.
      if (!isRedirectUriAllowed(redirect_uri)) {
        return response.status(400).json({ error: "redirect_uri not allowed" });
      }
      if (typeof state !== "string" || !state) {
        return response.status(400).json({ error: "state is required" });
      }
      const stateEntry = consumeOauthState(state);
      if (!stateEntry) {
        logger.warn("state invalido, expirado, ou reutilizado", {
          state_prefix: state.slice(0, 8),
          route: "ml-auth/exchange_code",
        });
        return response.status(400).json({ error: "invalid or expired state" });
      }
      if (stateEntry.redirectUri !== redirect_uri) {
        return response.status(400).json({ error: "redirect_uri mismatch" });
      }
      if (stateEntry.profileId && profile?.id && stateEntry.profileId !== profile.id) {
        return response.status(403).json({ error: "state profile mismatch" });
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
        // Sprint 2.1: nao retornar `details` bruto pro cliente —
        // pode conter metadata util pra atacante. Logar server-side.
        const details = await tokenResponse.text().catch(() => "");
        logger.warn("token exchange failed", {
          status: tokenResponse.status,
          details,
          route: "ml-auth/exchange_code",
        });
        return response.status(tokenResponse.status).json({
          error: "Token exchange failed",
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
