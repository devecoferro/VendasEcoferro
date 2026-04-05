import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
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
import {
  deleteLocalUser,
  getLocalSessionUser,
  listLocalUsers,
  loginLocalUser,
  logoutLocalUser,
  saveLocalUser,
  toggleLocalUserActive,
} from "@/services/localAuthFallback";

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
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  saveUser: (input: SaveUserInput) => Promise<void>;
  toggleUserActive: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  canAccessLocation: (locationLabel: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
type AuthMode = "remote" | "local";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("remote");

  const hydrateAuthState = useCallback(async () => {
    try {
      try {
        const authenticatedUser = await getCurrentRemoteUser();
        if (authenticatedUser) {
          setAuthMode("remote");
          setCurrentUser(authenticatedUser);

          if (authenticatedUser.role === "admin") {
            const remoteUsers = await listRemoteUsers();
            setUsers(remoteUsers);
          } else {
            setUsers([authenticatedUser]);
          }

          return;
        }
      } catch (error) {
        console.error("Failed to hydrate auth state:", error);
      }

      try {
        const localUser = await getLocalSessionUser();
        if (localUser) {
          setAuthMode("local");
          setCurrentUser(localUser);
          setUsers(localUser.role === "admin" ? await listLocalUsers() : [localUser]);
          return;
        }
      } catch (error) {
        console.error("Failed to hydrate local auth state:", error);
      }

      setAuthMode("remote");
      setCurrentUser(null);
      setUsers([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const runHydration = async () => {
      await hydrateAuthState();
      if (cancelled) return;
    };

    void runHydration();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void hydrateAuthState();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrateAuthState]);

  const login = async (username: string, password: string) => {
    setReady(false);

    try {
      await signInWithUsername(username, password);
      setAuthMode("remote");
      await hydrateAuthState();
      return;
    } catch (remoteError) {
      console.error("Remote login failed, using local fallback:", remoteError);
    }

    const localUser = await loginLocalUser(username, password);
    setAuthMode("local");
    setCurrentUser(localUser);
    setUsers(localUser.role === "admin" ? await listLocalUsers() : [localUser]);
    setReady(true);
  };

  const logout = async () => {
    setReady(false);

    try {
      if (authMode === "remote") {
        await signOutRemote();
      }
    } catch (error) {
      console.error("Remote logout failed:", error);
    } finally {
      await logoutLocalUser();
      setCurrentUser(null);
      setUsers([]);
      setReady(true);
    }
  };

  const saveUser = async (input: SaveUserInput) => {
    const updatedUsers =
      authMode === "remote"
        ? await saveRemoteUser(input)
        : await saveLocalUser(input);

    setUsers(updatedUsers);

    if (currentUser && updatedUsers.some((user) => user.id === currentUser.id)) {
      const updatedCurrentUser = updatedUsers.find((user) => user.id === currentUser.id) || null;
      setCurrentUser(updatedCurrentUser);
    }
  };

  const toggleUserActive = async (userId: string) => {
    const updatedUsers =
      authMode === "remote"
        ? await toggleRemoteUserActive(userId)
        : await toggleLocalUserActive(userId);

    setUsers(updatedUsers);

    if (currentUser?.id === userId) {
      const updatedCurrentUser = updatedUsers.find((user) => user.id === userId) || null;
      if (!updatedCurrentUser?.active) {
        if (authMode === "remote") {
          await signOutRemote();
        } else {
          await logoutLocalUser();
        }

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
      const updatedUsers =
        authMode === "remote"
          ? await deleteRemoteUser(userId)
          : await deleteLocalUser(userId);

      setUsers(updatedUsers);

      if (currentUser?.id === userId) {
        if (authMode === "remote") {
          await signOutRemote();
        } else {
          await logoutLocalUser();
        }

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
