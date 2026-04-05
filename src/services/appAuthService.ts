import {
  ALL_LOCATIONS_ACCESS,
  type AuthUser,
  type SaveUserInput,
} from "@/types/auth";
import {
  deleteLocalUser,
  getLocalSessionUser,
  listLocalUsers,
  loginLocalUser,
  logoutLocalUser,
  saveLocalUser,
  toggleLocalUserActive,
} from "@/services/localAuthFallback";

export async function prepareRemoteLogin(username: string): Promise<string> {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!normalizedUsername) {
    throw new Error("Informe um usuario valido.");
  }

  return `local-${normalizedUsername}@auth.ecoferro.local`;
}

export async function signInWithUsername(
  username: string,
  password: string
): Promise<void> {
  await loginLocalUser(username, password);
}

export async function signOutRemote(): Promise<void> {
  await logoutLocalUser();
}

export async function getCurrentRemoteUser(): Promise<AuthUser | null> {
  return await getLocalSessionUser();
}

export async function listRemoteUsers(): Promise<AuthUser[]> {
  return await listLocalUsers();
}

export async function saveRemoteUser(input: SaveUserInput): Promise<AuthUser[]> {
  const payload: SaveUserInput = {
    ...input,
    username: String(input.username || "").trim().toLowerCase(),
    allowedLocations:
      input.role === "admin"
        ? [ALL_LOCATIONS_ACCESS]
        : input.allowedLocations,
  };

  return await saveLocalUser(payload);
}

export async function toggleRemoteUserActive(userId: string): Promise<AuthUser[]> {
  return await toggleLocalUserActive(userId);
}

export async function deleteRemoteUser(userId: string): Promise<AuthUser[]> {
  return await deleteLocalUser(userId);
}
