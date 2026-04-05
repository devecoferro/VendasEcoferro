import {
  ALL_LOCATIONS_ACCESS,
  assertAdminTransitionAllowed,
  buildLoginEmail,
  createAdminClient,
  hasServiceRoleKey,
  normalizeUsername,
  parseRequestBody,
  requireAdmin,
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

async function listProfiles(adminClient) {
  const { data, error } = await adminClient
    .from("app_user_profiles")
    .select("id, username, login_email, role, allowed_locations, active, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data.map(serializeProfile) : [];
}

async function createUser(adminClient, input) {
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

  if (role !== "admin" && allowedLocations.length === 0) {
    throw new Error("Selecione ao menos um local para este usuario.");
  }

  const loginEmail = buildLoginEmail(username);
  const { data, error } = await adminClient.auth.admin.createUser({
    email: loginEmail,
    password,
    email_confirm: true,
    user_metadata: {
      username,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new Error("Nao foi possivel criar o usuario.");
  }

  const { error: profileError } = await adminClient.from("app_user_profiles").insert({
    id: userId,
    username,
    login_email: loginEmail,
    role,
    allowed_locations: allowedLocations,
    active,
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(profileError.message);
  }
}

async function updateUser(adminClient, actingUserId, input) {
  const userId = String(input.id || "");
  if (!userId) {
    throw new Error("Usuario nao informado.");
  }

  const currentProfile = await adminClient
    .from("app_user_profiles")
    .select("id, username, login_email, role, allowed_locations, active")
    .eq("id", userId)
    .maybeSingle();

  if (currentProfile.error) {
    throw new Error(currentProfile.error.message);
  }

  if (!currentProfile.data) {
    throw new Error("Usuario nao encontrado.");
  }

  const username = normalizeUsername(input.username || currentProfile.data.username);
  const role = sanitizeRole(input.role || currentProfile.data.role);
  const active = sanitizeBoolean(input.active, currentProfile.data.active);
  const allowedLocations = buildAllowedLocations(
    role,
    input.allowedLocations || currentProfile.data.allowed_locations
  );

  if (role !== "admin" && allowedLocations.length === 0) {
    throw new Error("Selecione ao menos um local para este usuario.");
  }

  await assertAdminTransitionAllowed(adminClient, actingUserId, userId, role, active);

  const loginEmail = buildLoginEmail(username);
  const authUpdates = {
    email: loginEmail,
    user_metadata: { username },
  };

  if (input.password) {
    authUpdates.password = input.password;
  }

  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, authUpdates);
  if (authError) {
    throw new Error(authError.message);
  }

  const { error: profileError } = await adminClient
    .from("app_user_profiles")
    .update({
      username,
      login_email: loginEmail,
      role,
      allowed_locations: allowedLocations,
      active,
    })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message);
  }
}

async function toggleUserActive(adminClient, actingUserId, userId) {
  const { data, error } = await adminClient
    .from("app_user_profiles")
    .select("id, active")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Usuario nao encontrado.");
  }

  const nextActive = !data.active;
  await assertAdminTransitionAllowed(adminClient, actingUserId, userId, undefined, nextActive);

  const { error: updateError } = await adminClient
    .from("app_user_profiles")
    .update({ active: nextActive })
    .eq("id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function deleteUser(adminClient, actingUserId, userId) {
  if (!userId) {
    throw new Error("Usuario nao informado.");
  }

  if (actingUserId === userId) {
    throw new Error("Nao e permitido remover o proprio usuario.");
  }

  await assertAdminTransitionAllowed(adminClient, actingUserId, userId, "operator", false);

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(error.message);
  }
}

export default async function handler(request, response) {
  if (!hasServiceRoleKey()) {
    return response.status(503).json({
      error: "SUPABASE_SERVICE_ROLE_KEY nao configurada na Vercel.",
    });
  }

  try {
    const { adminClient, authUser } = await requireAdmin(request);

    if (request.method === "GET") {
      const users = await listProfiles(adminClient);
      return response.status(200).json({ users });
    }

    if (request.method !== "POST") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = parseRequestBody(request);
    const action = body.action || "save";

    if (action === "save") {
      if (body.id) {
        await updateUser(adminClient, authUser.id, body);
      } else {
        await createUser(adminClient, body);
      }

      const users = await listProfiles(adminClient);
      return response.status(200).json({ users });
    }

    if (action === "toggle_active") {
      await toggleUserActive(adminClient, authUser.id, String(body.userId || ""));
      const users = await listProfiles(adminClient);
      return response.status(200).json({ users });
    }

    if (action === "delete") {
      await deleteUser(adminClient, authUser.id, String(body.userId || ""));
      const users = await listProfiles(adminClient);
      return response.status(200).json({ users });
    }

    return response.status(400).json({ error: "Unknown action" });
  } catch (error) {
    return response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
