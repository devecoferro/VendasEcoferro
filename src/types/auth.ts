export const ALL_LOCATIONS_ACCESS = "__all_locations__";

export type UserRole = "admin" | "operator";

export interface StoredAuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  allowedLocations: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  allowedLocations: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveUserInput {
  id?: string;
  username: string;
  password?: string;
  role: UserRole;
  allowedLocations: string[];
  active: boolean;
}
