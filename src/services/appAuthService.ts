import {
  ALL_LOCATIONS_ACCESS,
  type AuthUser,
  type SaveUserInput,
} from "@/types/auth";

interface AppAuthResponse {
  error?: string;
}

interface SessionResponse extends AppAuthResponse {
  user?: AuthUser;
}

interface UsersResponse extends AppAuthResponse {
  users?: AuthUser[];
}

const REMOTE_AUTH_TIMEOUT_MS = 8000;

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

/**
 * fetchWithTimeout: fetch com AbortController + timer limpo no finally.
 * Substitui o antigo `withTimeout(Promise, ...)` que NÃO abortava o fetch
 * original e vazava setTimeout quando a promise resolvia antes do timer.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function authenticatedFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await parseJsonResponse<T & AppAuthResponse>(response);
  if (!response.ok) {
    throw new Error(data.error || "Falha na requisicao.");
  }

  return data;
}

export async function signInWithUsername(
  username: string,
  password: string
): Promise<void> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Informe um usuario valido.");
  }

  const response = await fetchWithTimeout(
    "/api/app-auth",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "login",
        username: normalizedUsername,
        password,
      }),
    },
    REMOTE_AUTH_TIMEOUT_MS,
    "Timeout ao autenticar no painel."
  );

  const data = await parseJsonResponse<SessionResponse>(response);
  if (!response.ok) {
    throw new Error(data.error || "Falha ao autenticar.");
  }
}

export async function signOutRemote(): Promise<void> {
  await authenticatedFetch("/api/app-auth", {
    method: "POST",
    body: JSON.stringify({
      action: "logout",
    }),
  });
}

export async function getCurrentRemoteUser(): Promise<AuthUser | null> {
  const response = await fetchWithTimeout(
    "/api/app-auth",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "session",
      }),
    },
    REMOTE_AUTH_TIMEOUT_MS,
    "Timeout ao verificar sessao."
  );

  const data = await parseJsonResponse<SessionResponse>(response);
  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(data.error || "Falha ao carregar a sessao.");
  }

  return data.user || null;
}

export async function listRemoteUsers(): Promise<AuthUser[]> {
  const data = await authenticatedFetch<UsersResponse>("/api/app-users");
  return Array.isArray(data.users) ? data.users : [];
}

export async function saveRemoteUser(input: SaveUserInput): Promise<AuthUser[]> {
  const normalizedUsername = normalizeUsername(input.username);
  const payload: SaveUserInput = {
    ...input,
    username: normalizedUsername,
    allowedLocations:
      input.role === "admin"
        ? [ALL_LOCATIONS_ACCESS]
        : input.allowedLocations,
  };

  const data = await authenticatedFetch<UsersResponse>("/api/app-users", {
    method: "POST",
    body: JSON.stringify({
      action: "save",
      ...payload,
    }),
  });

  return Array.isArray(data.users) ? data.users : [];
}

export async function toggleRemoteUserActive(userId: string): Promise<AuthUser[]> {
  const data = await authenticatedFetch<UsersResponse>("/api/app-users", {
    method: "POST",
    body: JSON.stringify({
      action: "toggle_active",
      userId,
    }),
  });

  return Array.isArray(data.users) ? data.users : [];
}

export async function deleteRemoteUser(userId: string): Promise<AuthUser[]> {
  const data = await authenticatedFetch<UsersResponse>("/api/app-users", {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      userId,
    }),
  });

  return Array.isArray(data.users) ? data.users : [];
}
