export const ALL_LOCATIONS_ACCESS = "__all_locations__";

// 2026-04-30: granularidade de acesso por tela. "*" = todos.
export const ALL_MODULES_ACCESS = "*";

export type UserRole = "admin" | "operator";

/**
 * Catalogo de modulos/telas do app. Ordem aqui dita a ordem default
 * dos checkboxes na tela de Usuarios. `path` é a rota — usado pra
 * casar com URL no ProtectedRoute. `adminOnly` força a ser admin
 * mesmo que o user tenha o módulo na lista (ex: tela de usuarios).
 */
export const APP_MODULES = [
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "review", label: "Conferência", path: "/review" },
  { id: "conferencia_venda", label: "Conferência Venda", path: "/conferencia-venda" },
  { id: "history", label: "Histórico", path: "/history" },
  { id: "stock", label: "Estoque", path: "/stock" },
  { id: "ml", label: "Vendas Mercado Livre", path: "/mercado-livre" },
  { id: "fantom", label: "Vendas Fantom", path: "/mercado-livre-fantom" },
  { id: "manual", label: "Manual", path: "/manual" },
  { id: "report_debug", label: "Report Debug", path: "/report-debug" },
  { id: "users", label: "Usuários e acesso", path: "/users", adminOnly: true },
  { id: "ml_diagnostics", label: "Diagnóstico ML", path: "/ml-diagnostics", adminOnly: true },
] as const;

export type AppModuleId = (typeof APP_MODULES)[number]["id"];

export interface StoredAuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  allowedLocations: string[];
  allowedModules: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  allowedLocations: string[];
  allowedModules: string[];
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
  allowedModules: string[];
  active: boolean;
}
