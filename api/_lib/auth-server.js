import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import {
  APP_BASE_URL,
  APP_DEFAULT_ADMIN_PASSWORD,
  APP_DEFAULT_ADMIN_USERNAME,
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_TTL_DAYS,
} from "./app-config.js";
import { db } from "./db.js";

export const ALL_LOCATIONS_ACCESS = "__all_locations__";
export const DEFAULT_ADMIN_USERNAME = APP_DEFAULT_ADMIN_USERNAME;
export const DEFAULT_ADMIN_PASSWORD = APP_DEFAULT_ADMIN_PASSWORD;

const SESSION_TTL_MS = APP_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafely(value, fallback) {
  if (!value) return fallback;

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function mapProfileRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    login_email: row.login_email,
    password_hash: row.password_hash,
    role: row.role,
    allowed_locations: parseJsonSafely(row.allowed_locations, []),
    active: parseBoolean(row.active, true),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getProfileRowById(userId) {
  return mapProfileRow(
    db
      .prepare(
        `SELECT id, username, login_email, password_hash, role, allowed_locations, active, created_at, updated_at
         FROM app_user_profiles
         WHERE id = ?
         LIMIT 1`
      )
      .get(userId)
  );
}

function getProfileRowByUsername(username) {
  return mapProfileRow(
    db
      .prepare(
        `SELECT id, username, login_email, password_hash, role, allowed_locations, active, created_at, updated_at
         FROM app_user_profiles
         WHERE username = ?
         LIMIT 1`
      )
      .get(normalizeUsername(username))
  );
}

// Idle timeout: sessão inativa por mais que este valor é rejeitada mesmo
// que `expires_at` ainda esteja válido. Default 8 horas — tempo de uma
// jornada de trabalho. Override via env APP_SESSION_IDLE_TIMEOUT_MS.
const SESSION_IDLE_TIMEOUT_MS = Math.max(
  5 * 60 * 1000, // mínimo 5 minutos (evita disparos espúrios)
  Number.parseInt(
    process.env.APP_SESSION_IDLE_TIMEOUT_MS || String(8 * 60 * 60 * 1000),
    10
  ) || 8 * 60 * 60 * 1000
);

function getProfileRowBySessionHash(tokenHash) {
  // Filtra por expires_at E last_seen_at (idle timeout). Usa datetime() do
  // SQLite pra subtrair ms via epoch.
  // (strftime('%s','now') - strftime('%s',last_seen_at)) * 1000 = idade_ms
  const idleThresholdSec = Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000);
  return mapProfileRow(
    db
      .prepare(
        `SELECT p.id, p.username, p.login_email, p.password_hash, p.role, p.allowed_locations, p.active, p.created_at, p.updated_at
         FROM app_sessions s
         INNER JOIN app_user_profiles p ON p.id = s.user_id
         WHERE s.token_hash = ?
           AND datetime(s.expires_at) > datetime('now')
           AND (
             s.last_seen_at IS NULL
             OR (strftime('%s','now') - strftime('%s', s.last_seen_at)) < ?
           )
         LIMIT 1`
      )
      .get(tokenHash, idleThresholdSec)
  );
}

function removeExpiredSessions() {
  db.prepare(`DELETE FROM app_sessions WHERE datetime(expires_at) <= datetime('now')`).run();
}

function isSecureCookie() {
  return APP_BASE_URL.startsWith("https://");
}

function appendSetCookie(response, value) {
  const existing = response.getHeader("Set-Cookie");

  if (!existing) {
    response.setHeader("Set-Cookie", value);
    return;
  }

  if (Array.isArray(existing)) {
    response.setHeader("Set-Cookie", [...existing, value]);
    return;
  }

  response.setHeader("Set-Cookie", [existing, value]);
}

function buildSessionCookie(token) {
  const cookieParts = [
    `${APP_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

  if (isSecureCookie()) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function buildExpiredSessionCookie() {
  const cookieParts = [
    `${APP_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];

  if (isSecureCookie()) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function hashSessionToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function buildLoginEmail(username) {
  const normalized = normalizeUsername(username);
  const encoded = Buffer.from(normalized, "utf8").toString("hex");
  return `u-${encoded}@auth.ecoferro.local`;
}

export function sanitizeAllowedLocations(locations = []) {
  const uniqueLocations = new Map();

  for (const location of Array.isArray(locations) ? locations : []) {
    const trimmed = String(location || "").trim();
    if (!trimmed) continue;
    uniqueLocations.set(trimmed.toLowerCase(), trimmed);
  }

  return Array.from(uniqueLocations.values());
}

export function serializeProfile(profile) {
  if (!profile) return null;

  return {
    id: profile.id,
    username: profile.username,
    role: profile.role,
    allowedLocations: Array.isArray(profile.allowed_locations)
      ? profile.allowed_locations
      : [],
    active: Boolean(profile.active),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export function parseRequestBody(request) {
  if (!request.body) return {};

  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }

  return request.body;
}

function parseCookies(request) {
  const rawCookieHeader = request.headers.cookie || request.headers.Cookie;
  if (!rawCookieHeader || typeof rawCookieHeader !== "string") {
    return {};
  }

  return rawCookieHeader.split(";").reduce((cookies, part) => {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = String(rawKey || "").trim();
    if (!key) return cookies;

    cookies[key] = decodeURIComponent(rawValueParts.join("=").trim());
    return cookies;
  }, {});
}

export function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization;
  if (!authorization || typeof authorization !== "string") return null;

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function getSessionToken(request) {
  const bearerToken = getBearerToken(request);
  if (bearerToken) return bearerToken;

  const cookies = parseCookies(request);
  return cookies[APP_SESSION_COOKIE_NAME] || null;
}

// AUTH-2: parâmetros scrypt fortalecidos. Default Node é N=16384 (fraco).
// Usamos N=32768 (2^15) + maxmem 64MB — 2x mais forte que o default sem
// estourar limites de memória do Node em ambientes restritos (VPS/CI).
// Benchmark: ~60-80ms por hash na VPS (aceitável, não afeta UX de login).
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function createPasswordHash(password, salt = randomBytes(16).toString("hex")) {
  const derivedKey = scryptSync(String(password), salt, 64, SCRYPT_PARAMS).toString("hex");
  return `scrypt:${salt}:${derivedKey}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;

  const [algorithm, salt, existingHash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !existingHash) {
    return false;
  }

  const expected = Buffer.from(existingHash, "hex");
  // Hashes antigos (criados antes do fortalecimento) não foram rehashed.
  // verifyPassword tenta com params novos; se falhar por performance/length
  // mismatch, cai no legacy (default Node params) pra não invalidar sessões
  // existentes. No próximo login bem-sucedido, a senha pode ser re-hashed.
  try {
    const received = Buffer.from(
      scryptSync(String(password), salt, expected.length, SCRYPT_PARAMS).toString("hex"),
      "hex"
    );
    if (expected.length === received.length && timingSafeEqual(expected, received)) {
      return true;
    }
  } catch {
    // Fallback pros defaults antigos se cost params mudaram
  }
  try {
    const legacy = Buffer.from(
      scryptSync(String(password), salt, expected.length).toString("hex"),
      "hex"
    );
    return expected.length === legacy.length && timingSafeEqual(expected, legacy);
  } catch {
    return false;
  }
}

function createSession(userId) {
  removeExpiredSessions();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(
    `
      INSERT INTO app_sessions (
        id,
        user_id,
        token_hash,
        last_seen_at,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @user_id,
        @token_hash,
        @last_seen_at,
        @expires_at,
        @created_at,
        @updated_at
      )
    `
  ).run({
    id: randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    last_seen_at: createdAt,
    expires_at: expiresAt,
    created_at: createdAt,
    updated_at: createdAt,
  });

  return token;
}

export function revokeSessionByToken(token) {
  if (!token) return;
  db.prepare(`DELETE FROM app_sessions WHERE token_hash = ?`).run(hashSessionToken(token));
}

export function revokeSessionsByUserId(userId) {
  db.prepare(`DELETE FROM app_sessions WHERE user_id = ?`).run(userId);
}

export function applySessionCookie(response, token) {
  appendSetCookie(response, buildSessionCookie(token));
}

export function clearSessionCookie(response) {
  appendSetCookie(response, buildExpiredSessionCookie());
}

// Guard: só permite re-sync de password no startup (via ensureDefaultAdmin()
// chamado de server/index.js). Requests normais de auth NÃO devem sobrescrever
// a senha do admin — isso criava um backdoor permanente (AUTH-5).
let _allowPasswordSync = false;
export function enableDefaultAdminPasswordSync() {
  _allowPasswordSync = true;
}
export function disableDefaultAdminPasswordSync() {
  _allowPasswordSync = false;
}

export async function ensureDefaultAdmin() {
  if (!DEFAULT_ADMIN_USERNAME || !DEFAULT_ADMIN_PASSWORD) {
    return null;
  }

  const existingProfile = getProfileRowByUsername(DEFAULT_ADMIN_USERNAME);

  if (existingProfile) {
    // Sincronizar senha APENAS no startup (quando _allowPasswordSync = true).
    // Em requests normais, não reescreve a senha — protege contra backdoor.
    if (_allowPasswordSync) {
      const passwordMatches = verifyPassword(DEFAULT_ADMIN_PASSWORD, existingProfile.password_hash);
      if (!passwordMatches) {
        const newHash = createPasswordHash(DEFAULT_ADMIN_PASSWORD);
        db.prepare(
          `UPDATE app_user_profiles SET password_hash = ?, active = 1, updated_at = ? WHERE id = ?`
        ).run(newHash, nowIso(), existingProfile.id);
        console.log(`[auth] Admin password synced from env vars for user "${DEFAULT_ADMIN_USERNAME}" (startup only).`);
      }
    }
    // Garantir que está ativo (safe pra ser chamado sempre)
    if (!existingProfile.active) {
      db.prepare(
        `UPDATE app_user_profiles SET active = 1, updated_at = ? WHERE id = ?`
      ).run(nowIso(), existingProfile.id);
    }
    return getProfileRowById(existingProfile.id);
  }

  const timestamp = nowIso();
  const id = randomUUID();

  db.prepare(
    `
      INSERT INTO app_user_profiles (
        id,
        username,
        login_email,
        password_hash,
        role,
        allowed_locations,
        active,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @username,
        @login_email,
        @password_hash,
        @role,
        @allowed_locations,
        @active,
        @created_at,
        @updated_at
      )
    `
  ).run({
    id,
    username: DEFAULT_ADMIN_USERNAME,
    login_email: buildLoginEmail(DEFAULT_ADMIN_USERNAME),
    password_hash: createPasswordHash(DEFAULT_ADMIN_PASSWORD),
    role: "admin",
    allowed_locations: JSON.stringify([ALL_LOCATIONS_ACCESS]),
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });

  console.log(`[auth] Default admin "${DEFAULT_ADMIN_USERNAME}" created.`);
  return getProfileRowById(id);
}

export function getProfileById(_dbInstance, userId) {
  return getProfileRowById(userId);
}

export function getProfileByUsername(_dbInstance, username) {
  return getProfileRowByUsername(username);
}

// S8 do audit: hash dummy pra mitigar user enumeration via timing.
// Sempre calcula scrypt (caro) mesmo quando username não existe,
// igualando o tempo de resposta "username inválido" vs "senha inválida".
const DUMMY_HASH = createPasswordHash("dummy_password_not_real_a1b2c3d4");

export async function authenticateUser(username, password, response) {
  // NÃO chamar ensureDefaultAdmin aqui — é chamado uma vez no startup
  // (server/index.js). Chamar em cada login permite backdoor de senha via env.
  const profile = getProfileRowByUsername(username);

  const invalidCredentialsError = () => {
    const error = new Error("Usuario ou senha invalidos.");
    error.statusCode = 401;
    return error;
  };

  if (!profile || !profile.active) {
    // Roda verifyPassword contra hash dummy pra consumir o mesmo tempo
    // de CPU do caminho "usuário válido + senha errada". Resultado descartado.
    verifyPassword(String(password || ""), DUMMY_HASH);
    throw invalidCredentialsError();
  }

  if (!verifyPassword(password, profile.password_hash)) {
    throw invalidCredentialsError();
  }

  const sessionToken = createSession(profile.id);
  applySessionCookie(response, sessionToken);
  return serializeProfile(profile);
}

export async function getAuthenticatedProfile(request) {
  // NÃO chamar ensureDefaultAdmin aqui (ver authenticateUser).
  // Evita scryptSync pesado em cada request autenticado.
  removeExpiredSessions();

  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return { authUser: null, profile: null, sessionToken: null };
  }

  const profile = getProfileRowBySessionHash(hashSessionToken(sessionToken));
  if (!profile || !profile.active) {
    return { authUser: null, profile: null, sessionToken: null };
  }

  db.prepare(
    `UPDATE app_sessions SET last_seen_at = ?, updated_at = ? WHERE token_hash = ?`
  ).run(nowIso(), nowIso(), hashSessionToken(sessionToken));

  return {
    authUser: {
      id: profile.id,
      username: profile.username,
    },
    profile,
    sessionToken,
  };
}

export async function requireAdmin(request) {
  const { authUser, profile, sessionToken } = await getAuthenticatedProfile(request);

  if (!authUser || !profile || !profile.active || profile.role !== "admin") {
    const error = new Error("Acesso negado.");
    error.statusCode = 403;
    throw error;
  }

  return { authUser, profile, sessionToken };
}

export async function requireAuthenticatedProfile(request) {
  const { authUser, profile, sessionToken } = await getAuthenticatedProfile(request);

  if (!authUser || !profile || !profile.active) {
    const error = new Error("Sessao invalida.");
    error.statusCode = 401;
    throw error;
  }

  return { authUser, profile, sessionToken };
}

export function countActiveAdmins() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM app_user_profiles WHERE role = 'admin' AND active = 1`
    )
    .get();

  return Number(row?.total || 0);
}

export async function assertAdminTransitionAllowed(
  _dbInstance,
  actingUserId,
  targetUserId,
  nextRole,
  nextActive
) {
  const currentProfile = getProfileRowById(targetUserId);
  if (!currentProfile) {
    throw new Error("Usuario nao encontrado.");
  }

  const roleAfterChange = nextRole ?? currentProfile.role;
  const activeAfterChange =
    typeof nextActive === "boolean" ? nextActive : Boolean(currentProfile.active);

  if (actingUserId === targetUserId && (!activeAfterChange || roleAfterChange !== "admin")) {
    throw new Error("Nao e permitido remover o proprio acesso de administrador.");
  }

  if (
    currentProfile.role === "admin" &&
    currentProfile.active &&
    (!activeAfterChange || roleAfterChange !== "admin")
  ) {
    const activeAdmins = countActiveAdmins();
    if (activeAdmins <= 1) {
      throw new Error("E necessario manter pelo menos um administrador ativo.");
    }
  }
}

