import { randomUUID } from "node:crypto";

import { db } from "./_lib/db.js";
import {
  ALL_LOCATIONS_ACCESS,
  assertAdminTransitionAllowed,
  buildLoginEmail,
  createPasswordHash,
  getProfileById,
  getProfileByUsername,
  normalizeUsername,
  parseRequestBody,
  requireAdmin,
  revokeSessionsByUserId,
  sanitizeAllowedLocations,
  serializeProfile,
} from "./_lib/auth-server.js";

function sanitizeRole(role) {
  return role === "admin" ? "admin" : "operator";
}

function sanitizeBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function buildAllowedLocations(role, allowedLocations) {
  if (role === "admin") {
    return [ALL_LOCATIONS_ACCESS];
  }

  const sanitized = sanitizeAllowedLocations(allowedLocations);
  if (sanitized.includes(ALL_LOCATIONS_ACCESS)) {
    return [ALL_LOCATIONS_ACCESS];
  }
  return sanitized;
}

function listProfiles() {
  const rows = db
    .prepare(
      `SELECT id, username, login_email, password_hash, role, allowed_locations, active, created_at, updated_at
       FROM app_user_profiles
       ORDER BY datetime(created_at) DESC`
    )
    .all();

  return rows
    .map((row) =>
      serializeProfile({
        ...row,
        allowed_locations: JSON.parse(row.allowed_locations || "[]"),
        active: Boolean(row.active),
      })
    )
    .filter(Boolean);
}

function createUser(input) {
  const username = normalizeUsername(input.username);
  const role = sanitizeRole(input.role);
  const active = sanitizeBoolean(input.active, true);
  const allowedLocations = buildAllowedLocations(role, input.allowedLocations);
  const password = String(input.password || "");

  if (!username) {
    throw new Error("Informe um usuario valido.");
  }

  if (!password) {
    throw new Error("Informe uma senha para o novo usuario.");
  }

  if (getProfileByUsername(null, username)) {
    throw new Error("Ja existe um usuario com esse nome.");
  }

  if (role !== "admin" && allowedLocations.length === 0) {
    throw new Error("Selecione ao menos um local para este usuario.");
  }

  const timestamp = new Date().toISOString();
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
    id: randomUUID(),
    username,
    login_email: buildLoginEmail(username),
    password_hash: createPasswordHash(password),
    role,
    allowed_locations: JSON.stringify(allowedLocations),
    active: active ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function updateUser(actingUserId, input) {
  const userId = String(input.id || "");
  if (!userId) {
    throw new Error("Usuario nao informado.");
  }

  const currentProfile = getProfileById(null, userId);
  if (!currentProfile) {
    throw new Error("Usuario nao encontrado.");
  }

  const username = normalizeUsername(input.username || currentProfile.username);
  const role = sanitizeRole(input.role || currentProfile.role);
  const active = sanitizeBoolean(input.active, currentProfile.active);
  const allowedLocations = buildAllowedLocations(
    role,
    input.allowedLocations || currentProfile.allowed_locations
  );

  if (role !== "admin" && allowedLocations.length === 0) {
    throw new Error("Selecione ao menos um local para este usuario.");
  }

  const conflictingProfile = getProfileByUsername(null, username);
  if (conflictingProfile && conflictingProfile.id !== userId) {
    throw new Error("Ja existe um usuario com esse nome.");
  }

  return assertAdminTransitionAllowed(null, actingUserId, userId, role, active).then(() => {
    db.prepare(
      `
        UPDATE app_user_profiles
        SET
          username = @username,
          login_email = @login_email,
          password_hash = COALESCE(@password_hash, password_hash),
          role = @role,
          allowed_locations = @allowed_locations,
          active = @active,
          updated_at = @updated_at
        WHERE id = @id
      `
    ).run({
      id: userId,
      username,
      login_email: buildLoginEmail(username),
      password_hash: input.password ? createPasswordHash(input.password) : null,
      role,
      allowed_locations: JSON.stringify(allowedLocations),
      active: active ? 1 : 0,
      updated_at: new Date().toISOString(),
    });
  });
}

async function toggleUserActive(actingUserId, userId) {
  const currentProfile = getProfileById(null, userId);
  if (!currentProfile) {
    throw new Error("Usuario nao encontrado.");
  }

  const nextActive = !currentProfile.active;
  await assertAdminTransitionAllowed(null, actingUserId, userId, undefined, nextActive);

  db.prepare(
    `UPDATE app_user_profiles SET active = ?, updated_at = ? WHERE id = ?`
  ).run(nextActive ? 1 : 0, new Date().toISOString(), userId);

  if (!nextActive) {
    revokeSessionsByUserId(userId);
  }
}

async function deleteUser(actingUserId, userId) {
  if (!userId) {
    throw new Error("Usuario nao informado.");
  }

  if (actingUserId === userId) {
    throw new Error("Nao e permitido remover o proprio usuario.");
  }

  await assertAdminTransitionAllowed(null, actingUserId, userId, "operator", false);
  revokeSessionsByUserId(userId);
  db.prepare(`DELETE FROM app_user_profiles WHERE id = ?`).run(userId);
}

export default async function handler(request, response) {
  try {
    const { authUser } = await requireAdmin(request);

    if (request.method === "GET") {
      return response.status(200).json({ users: listProfiles() });
    }

    if (request.method !== "POST") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = parseRequestBody(request);
    const action = body.action || "save";

    if (action === "save") {
      if (body.id) {
        await updateUser(authUser.id, body);
      } else {
        createUser(body);
      }

      return response.status(200).json({ users: listProfiles() });
    }

    if (action === "toggle_active") {
      await toggleUserActive(authUser.id, String(body.userId || ""));
      return response.status(200).json({ users: listProfiles() });
    }

    if (action === "delete") {
      await deleteUser(authUser.id, String(body.userId || ""));
      return response.status(200).json({ users: listProfiles() });
    }

    return response.status(400).json({ error: "Unknown action" });
  } catch (error) {
    return response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
