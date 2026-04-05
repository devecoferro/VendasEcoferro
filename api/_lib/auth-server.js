import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.SUPABASE_URL || "https://gyaddryvtuzllcggorjc.supabase.co").trim();

const SUPABASE_PUBLISHABLE_KEY =
  (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_USdCDZTlvuXFTOBlAvYSpQ_ne5ka8Ee"
  ).trim();

const SUPABASE_SERVICE_ROLE_KEY =
  (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();

export const ALL_LOCATIONS_ACCESS = "__all_locations__";
export const DEFAULT_ADMIN_USERNAME = "admin.ecoferro";
export const DEFAULT_ADMIN_PASSWORD = "Ecoferro@2024";

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

export function hasServiceRoleKey() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY);
}

export function createAdminClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createPublicClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
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

export function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization;
  if (!authorization || typeof authorization !== "string") return null;

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
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

export async function getProfileById(adminClient, userId) {
  const { data, error } = await adminClient
    .from("app_user_profiles")
    .select("id, username, login_email, role, allowed_locations, active, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getProfileByUsername(adminClient, username) {
  const { data, error } = await adminClient
    .from("app_user_profiles")
    .select("id, username, login_email, role, allowed_locations, active, created_at, updated_at")
    .eq("username", normalizeUsername(username))
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function findAuthUserByEmail(adminClient, email) {
  const { data, error } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data?.users?.find((user) => user.email === email) ?? null;
}

export async function ensureDefaultAdmin(adminClient) {
  const existingAdminProfile = await getProfileByUsername(adminClient, DEFAULT_ADMIN_USERNAME);
  if (existingAdminProfile) {
    return existingAdminProfile;
  }

  const loginEmail = buildLoginEmail(DEFAULT_ADMIN_USERNAME);
  let userId = null;

  const existingAuthUser = await findAuthUserByEmail(adminClient, loginEmail);
  if (existingAuthUser) {
    userId = existingAuthUser.id;
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: loginEmail,
      password: DEFAULT_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        username: DEFAULT_ADMIN_USERNAME,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    userId = data.user?.id ?? null;
  }

  if (!userId) {
    throw new Error("Unable to create default admin user.");
  }

  const { error: upsertError } = await adminClient
    .from("app_user_profiles")
    .upsert(
      {
        id: userId,
        username: DEFAULT_ADMIN_USERNAME,
        login_email: loginEmail,
        role: "admin",
        allowed_locations: [ALL_LOCATIONS_ACCESS],
        active: true,
      },
      { onConflict: "id" }
    );

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  return getProfileById(adminClient, userId);
}

export async function getAuthenticatedProfile(request) {
  const token = getBearerToken(request);
  if (!token) {
    return { adminClient: null, authUser: null, profile: null };
  }

  const adminClient = createAdminClient();
  const {
    data: { user },
    error,
  } = await adminClient.auth.getUser(token);

  if (error || !user) {
    return { adminClient, authUser: null, profile: null };
  }

  const profile = await getProfileById(adminClient, user.id);
  return { adminClient, authUser: user, profile };
}

export async function requireAdmin(request) {
  const { adminClient, authUser, profile } = await getAuthenticatedProfile(request);

  if (!authUser || !profile || !profile.active || profile.role !== "admin") {
    const error = new Error("Acesso negado.");
    error.statusCode = 403;
    throw error;
  }

  return { adminClient, authUser, profile };
}

export async function countActiveAdmins(adminClient) {
  const { count, error } = await adminClient
    .from("app_user_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true);

  if (error) {
    throw new Error(error.message);
  }

  return count || 0;
}

export async function assertAdminTransitionAllowed(
  adminClient,
  actingUserId,
  targetUserId,
  nextRole,
  nextActive
) {
  const currentProfile = await getProfileById(adminClient, targetUserId);
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
    const activeAdmins = await countActiveAdmins(adminClient);
    if (activeAdmins <= 1) {
      throw new Error("E necessario manter pelo menos um administrador ativo.");
    }
  }
}
