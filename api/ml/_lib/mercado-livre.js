import {
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
  ensureMercadoLivreCredentials,
} from "./app-config.js";
import { getConnectionById, updateConnectionTokens } from "./storage.js";

export function isTokenExpiringSoon(tokenExpiresAt) {
  if (!tokenExpiresAt) return true;
  const expiresAt = new Date(tokenExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() <= Date.now() + 60 * 1000;
}

// ─── Mutex de refresh token por connection_id ─────────────────────────
// ML rotaciona o refresh_token a cada chamada a /oauth/token — usar o mesmo
// refresh_token em duas chamadas simultâneas invalida a primeira, quebrando
// toda a conexão até OAuth manual. Esse Map de promises inflight garante
// que apenas UMA refresh roda por connection_id; chamadas concorrentes
// aguardam a mesma promise e recebem o novo token.
const refreshInflight = new Map();

async function doRefreshToken(connectionId) {
  ensureMercadoLivreCredentials();

  const connection = getConnectionById(connectionId);
  if (!connection?.refresh_token) {
    throw new Error("Conexao sem refresh token valido.");
  }

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
    }).toString(),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao renovar token do Mercado Livre: ${details}`);
  }

  const payload = await response.json();

  return updateConnectionTokens(connectionId, {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_expires_at: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
  });
}

export async function refreshMercadoLivreToken(connectionId) {
  const key = String(connectionId);
  const existing = refreshInflight.get(key);
  if (existing) return existing;

  const promise = doRefreshToken(connectionId).finally(() => {
    if (refreshInflight.get(key) === promise) {
      refreshInflight.delete(key);
    }
  });
  refreshInflight.set(key, promise);
  return promise;
}

export async function ensureValidAccessToken(connection) {
  if (!connection?.id) {
    throw new Error("Conexao do Mercado Livre nao encontrada.");
  }

  if (!isTokenExpiringSoon(connection.token_expires_at)) {
    return connection;
  }

  return refreshMercadoLivreToken(connection.id);
}
