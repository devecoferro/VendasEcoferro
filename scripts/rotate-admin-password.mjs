import { randomBytes } from "node:crypto";

import { resolveAdminCredentials, persistRotatedAdminCredentials } from "./_lib/admin-credentials.mjs";

const baseUrl = process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
const targetUsername = process.env.ECOFERRO_ADMIN_TARGET || "admin.ecoferro";

function normalizeSetCookieHeader(headerValue) {
  if (!headerValue) return "";
  const rawHeaders = Array.isArray(headerValue) ? headerValue : [headerValue];
  return rawHeaders
    .map((entry) => String(entry || "").split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function buildStrongPassword() {
  return `Ecoferro!${randomBytes(18).toString("base64url")}`;
}

async function apiRequest(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text().catch(() => "");

  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  return { response, payload };
}

async function login(username, password) {
  const { response, payload } = await apiRequest("/api/app-auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "login",
      username,
      password,
    }),
  });

  const cookie = normalizeSetCookieHeader(
    response.headers.getSetCookie?.() || response.headers.get("set-cookie")
  );

  return {
    ok: response.ok && Boolean(cookie),
    status: response.status,
    cookie,
    payload,
  };
}

async function getUsers(cookie) {
  const { response, payload } = await apiRequest("/api/app-users", {
    headers: {
      Cookie: cookie,
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao listar usuarios (${response.status}).`);
  }

  return Array.isArray(payload?.users) ? payload.users : [];
}

async function updateUserPassword(cookie, userId, password) {
  const { response, payload } = await apiRequest("/api/app-users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "save",
      id: userId,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Falha ao atualizar senha (${response.status}): ${JSON.stringify(payload || {})}`
    );
  }

  return payload;
}

async function checkSession(cookie) {
  const { response, payload } = await apiRequest("/api/app-auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "session",
    }),
  });

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

const currentCredentials = resolveAdminCredentials();
const nextPassword = buildStrongPassword();

const currentLogin = await login(currentCredentials.username, currentCredentials.password);
if (!currentLogin.ok) {
  throw new Error(
    `Falha no login com a credencial atual (${currentLogin.status}): ${JSON.stringify(currentLogin.payload || {})}`
  );
}

const users = await getUsers(currentLogin.cookie);
const targetUser = users.find((user) => String(user?.username || "").trim() === targetUsername);
if (!targetUser?.id) {
  throw new Error(`Usuario ${targetUsername} nao encontrado para rotacao de senha.`);
}

await updateUserPassword(currentLogin.cookie, targetUser.id, nextPassword);

const oldPasswordLogin = await login(currentCredentials.username, currentCredentials.password);
const newPasswordLogin = await login(currentCredentials.username, nextPassword);
const currentSessionCheck = await checkSession(currentLogin.cookie);

if (!newPasswordLogin.ok) {
  throw new Error(
    `A nova senha foi salva, mas o login de validacao falhou (${newPasswordLogin.status}).`
  );
}

const persisted = persistRotatedAdminCredentials({
  username: currentCredentials.username,
  password: nextPassword,
  rotated_at: new Date().toISOString(),
  base_url: baseUrl,
});

console.log(
  JSON.stringify(
    {
      status: "ok",
      username: currentCredentials.username,
      changed_user_id: targetUser.id,
      sessions_revoked: false,
      current_session_preserved: currentSessionCheck.ok,
      old_password_rejected: !oldPasswordLogin.ok,
      new_password_validated: newPasswordLogin.ok,
      credential_file: persisted.rotationPath,
      latest_credential_file: persisted.latestRotationPath,
    },
    null,
    2
  )
);
