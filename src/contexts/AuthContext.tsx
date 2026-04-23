import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ALL_LOCATIONS_ACCESS,
  type AuthUser,
  type SaveUserInput,
} from "@/types/auth";
import {
  deleteRemoteUser,
  getCurrentRemoteUser,
  listRemoteUsers,
  saveRemoteUser,
  signInWithUsername,
  signOutRemote,
  toggleRemoteUserActive,
} from "@/services/appAuthService";

const DEFAULT_LOCATION_OPTIONS = [
  "Ourinhos Rua Dario Alonso",
  "Full",
  "Vendas sem deposito",
];

interface AuthContextValue {
  currentUser: AuthUser | null;
  users: AuthUser[];
  ready: boolean;
  locationOptions: string[];
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  saveUser: (input: SaveUserInput) => Promise<void>;
  toggleUserActive: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  canAccessLocation: (locationLabel: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [ready, setReady] = useState(false);

  const hydrateAuthState = useCallback(async () => {
    try {
      try {
        // Dispara ambas as chamadas em paralelo para evitar waterfall sequencial.
        // listRemoteUsers retorna 401 se não for admin — tratamos silenciosamente.
        const [authenticatedUser, allUsers] = await Promise.all([
          getCurrentRemoteUser(),
          listRemoteUsers().catch(() => null),
        ]);

        if (authenticatedUser) {
          setCurrentUser(authenticatedUser);

          if (authenticatedUser.role === "admin" && Array.isArray(allUsers)) {
            setUsers(allUsers);
          } else {
            setUsers([authenticatedUser]);
          }

          return;
        }
      } catch (error) {
        console.error("Failed to hydrate auth state:", error);
      }
      setCurrentUser(null);
      setUsers([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void hydrateAuthState();
  }, [hydrateAuthState]);

  const login = async (username: string, password: string, totpCode?: string) => {
    setReady(false);

    try {
      await signInWithUsername(username, password, totpCode);
      await hydrateAuthState();
    } catch (error) {
      setCurrentUser(null);
      setUsers([]);
      setReady(true);
      throw error;
    }
  };

  const logout = async () => {
    setReady(false);

    try {
      await signOutRemote();
    } catch (error) {
      console.error("Remote logout failed:", error);
    } finally {
      setCurrentUser(null);
      setUsers([]);
      setReady(true);
    }
  };

  const saveUser = async (input: SaveUserInput) => {
    const updatedUsers = await saveRemoteUser(input);
    setUsers(updatedUsers);

    if (currentUser && updatedUsers.some((user) => user.id === currentUser.id)) {
      const updatedCurrentUser = updatedUsers.find((user) => user.id === currentUser.id) || null;
      setCurrentUser(updatedCurrentUser);
    }
  };

  const toggleUserActive = async (userId: string) => {
    const updatedUsers = await toggleRemoteUserActive(userId);
    setUsers(updatedUsers);

    if (currentUser?.id === userId) {
      const updatedCurrentUser = updatedUsers.find((user) => user.id === userId) || null;
      if (!updatedCurrentUser?.active) {
        await signOutRemote();
        setCurrentUser(null);
        setUsers([]);
        setReady(true);
        return;
      }
      setCurrentUser(updatedCurrentUser);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      const updatedUsers = await deleteRemoteUser(userId);
      setUsers(updatedUsers);

      if (currentUser?.id === userId) {
        await signOutRemote();
        setCurrentUser(null);
        setUsers([]);
      }
    } finally {
      setReady(true);
    }
  };

  const canAccessLocation = useCallback(
    (locationLabel: string) => {
      if (!currentUser) return false;
      if (currentUser.role === "admin") return true;
      if (currentUser.allowedLocations.includes(ALL_LOCATIONS_ACCESS)) return true;

      const normalizedLabel = locationLabel.trim().toLowerCase();
      return currentUser.allowedLocations.some(
        (location) => location.trim().toLowerCase() === normalizedLabel
      );
    },
    [currentUser]
  );

  const locationOptions = useMemo(() => {
    const collected = new Set(DEFAULT_LOCATION_OPTIONS);

    for (const user of users) {
      for (const location of user.allowedLocations) {
        if (location !== ALL_LOCATIONS_ACCESS) {
          collected.add(location);
        }
      }
    }

    if (currentUser) {
      for (const location of currentUser.allowedLocations) {
        if (location !== ALL_LOCATIONS_ACCESS) {
          collected.add(location);
        }
      }
    }

    return Array.from(collected.values()).sort((left, right) =>
      left.localeCompare(right, "pt-BR")
    );
  }, [currentUser, users]);

  const value: AuthContextValue = {
    currentUser,
    users,
    ready,
    locationOptions,
    login,
    logout,
    saveUser,
    toggleUserActive,
    deleteUser,
    canAccessLocation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
