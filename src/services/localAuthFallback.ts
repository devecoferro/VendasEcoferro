import {
  ALL_LOCATIONS_ACCESS,
  type AuthUser,
  type SaveUserInput,
  type StoredAuthUser,
} from "@/types/auth";

const USERS_STORAGE_KEY = "ecoferro.auth.users";
const SESSION_STORAGE_KEY = "ecoferro.auth.session";
const DEFAULT_FALLBACK_ADMIN_USERNAME = "admin.ecoferro";
const DEFAULT_FALLBACK_ADMIN_PASSWORD = "Ecoferro@2024";
let seedPromise: Promise<void> | null = null;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function hashPassword(password: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return password;
  }

  const payload = new TextEncoder().encode(password);
  const digest = await window.crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeStoredUsers(rawValue: unknown): StoredAuthUser[] {
  const parsedUsers = Array.isArray(rawValue) ? rawValue : [];
  const normalizedMap = new Map<string, StoredAuthUser>();

  for (const candidate of parsedUsers) {
    if (!candidate || typeof candidate !== "object") continue;

    const record = candidate as Partial<StoredAuthUser>;
    const username = String(record.username || "").trim().toLowerCase();
    if (!username) continue;

    normalizedMap.set(username, {
      id: String(record.id || `local-${username}`),
      username,
      passwordHash: String(record.passwordHash || ""),
      role: record.role === "admin" ? "admin" : "operator",
      allowedLocations: Array.isArray(record.allowedLocations)
        ? Array.from(
            new Set(
              record.allowedLocations
                .map((location) => String(location || "").trim())
                .filter(Boolean)
            )
          )
        : [],
      active: record.active !== false,
      createdAt: String(record.createdAt || new Date().toISOString()),
      updatedAt: String(record.updatedAt || record.createdAt || new Date().toISOString()),
    });
  }

  return Array.from(normalizedMap.values()).sort((left, right) =>
    left.username.localeCompare(right.username, "pt-BR")
  );
}

function readUsersFromStorage(): StoredAuthUser[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const users = normalizeStoredUsers(parsed);
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    return users;
  } catch {
    const users: StoredAuthUser[] = [];
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    return users;
  }
}

function writeUsersToStorage(users: StoredAuthUser[]): StoredAuthUser[] {
  const normalized = normalizeStoredUsers(users);
  if (canUseStorage()) {
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function setSession(username: string | null) {
  if (!canUseStorage()) return;

  if (username) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, username);
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function getSessionUsername(): string | null {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

function toAuthUser(user: StoredAuthUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    allowedLocations: user.allowedLocations,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function ensureLocalSeededUsers(): Promise<void> {
  if (!canUseStorage()) {
    return;
  }

  if (!seedPromise) {
    seedPromise = (async () => {
      const existingUsers = readUsersFromStorage();
      if (existingUsers.length > 0) {
        return;
      }

      const now = new Date().toISOString();
      const defaultAdmin: StoredAuthUser = {
        id: "local-admin-ecoferro",
        username: DEFAULT_FALLBACK_ADMIN_USERNAME,
        passwordHash: await hashPassword(DEFAULT_FALLBACK_ADMIN_PASSWORD),
        role: "admin",
        allowedLocations: [ALL_LOCATIONS_ACCESS],
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      writeUsersToStorage([defaultAdmin]);
    })().finally(() => {
      seedPromise = null;
    });
  }

  await seedPromise;
}

function ensureAdminCoverage(users: StoredAuthUser[]) {
  if (!users.some((user) => user.role === "admin" && user.active)) {
    throw new Error("E necessario manter pelo menos um administrador ativo.");
  }
}

function buildUserId(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function getLocalSessionUser(): Promise<AuthUser | null> {
  await ensureLocalSeededUsers();
  const username = String(getSessionUsername() || "").trim().toLowerCase();
  if (!username) return null;

  const user = readUsersFromStorage().find(
    (candidate) => candidate.username === username && candidate.active
  );

  if (!user) {
    setSession(null);
    return null;
  }

  return toAuthUser(user);
}

export async function loginLocalUser(username: string, password: string): Promise<AuthUser> {
  await ensureLocalSeededUsers();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!normalizedUsername || !password) {
    throw new Error("Informe usuario e senha.");
  }

  const user = readUsersFromStorage().find((candidate) => candidate.username === normalizedUsername);
  if (!user || !user.active) {
    throw new Error("Usuario ou senha invalidos.");
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    throw new Error("Usuario ou senha invalidos.");
  }

  setSession(user.username);
  return toAuthUser(user);
}

export async function logoutLocalUser(): Promise<void> {
  setSession(null);
}

export async function listLocalUsers(): Promise<AuthUser[]> {
  await ensureLocalSeededUsers();
  return readUsersFromStorage().map(toAuthUser);
}

export async function saveLocalUser(input: SaveUserInput): Promise<AuthUser[]> {
  await ensureLocalSeededUsers();
  const users = readUsersFromStorage();
  const now = new Date().toISOString();
  const username = String(input.username || "").trim().toLowerCase();

  if (!username) {
    throw new Error("Informe um usuario valido.");
  }

  const existingUser = input.id
    ? users.find((user) => user.id === input.id)
    : users.find((user) => user.username === username);

  if (!existingUser && !input.password) {
    throw new Error("Informe uma senha para o novo usuario.");
  }

  if (!input.id && users.some((user) => user.username === username)) {
    throw new Error("Ja existe um usuario com este nome.");
  }

  const passwordHash = input.password
    ? await hashPassword(input.password)
    : existingUser?.passwordHash || "";

  const nextRecord: StoredAuthUser = {
    id: existingUser?.id || buildUserId(),
    username,
    passwordHash,
    role: input.role,
    allowedLocations:
      input.role === "admin"
        ? [ALL_LOCATIONS_ACCESS]
        : Array.from(
            new Set(
              input.allowedLocations
                .map((location) => String(location || "").trim())
                .filter(Boolean)
            )
          ),
    active: input.active,
    createdAt: existingUser?.createdAt || now,
    updatedAt: now,
  };

  const nextUsers = existingUser
    ? users.map((user) => (user.id === existingUser.id ? nextRecord : user))
    : [...users, nextRecord];

  ensureAdminCoverage(nextUsers);
  return writeUsersToStorage(nextUsers).map(toAuthUser);
}

export async function toggleLocalUserActive(userId: string): Promise<AuthUser[]> {
  await ensureLocalSeededUsers();
  const users = readUsersFromStorage();
  const targetUser = users.find((user) => user.id === userId);
  if (!targetUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const nextUsers = users.map((user) =>
    user.id === userId
      ? {
          ...user,
          active: !user.active,
          updatedAt: new Date().toISOString(),
        }
      : user
  );

  ensureAdminCoverage(nextUsers);

  const sessionUsername = getSessionUsername();
  const updatedTarget = nextUsers.find((user) => user.id === userId);
  if (sessionUsername && updatedTarget && !updatedTarget.active && updatedTarget.username === sessionUsername) {
    setSession(null);
  }

  return writeUsersToStorage(nextUsers).map(toAuthUser);
}

export async function deleteLocalUser(userId: string): Promise<AuthUser[]> {
  await ensureLocalSeededUsers();
  const users = readUsersFromStorage();
  const targetUser = users.find((user) => user.id === userId);
  if (!targetUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const nextUsers = users.filter((user) => user.id !== userId);
  ensureAdminCoverage(nextUsers);

  if (getSessionUsername() === targetUser.username) {
    setSession(null);
  }

  return writeUsersToStorage(nextUsers).map(toAuthUser);
}
