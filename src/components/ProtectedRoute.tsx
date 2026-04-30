import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { AppModuleId } from "@/types/auth";

interface ProtectedRouteProps {
  requireAdmin?: boolean;
  /**
   * 2026-04-30: bloqueia rota quando o user nao tem o modulo na
   * lista de allowedModules. Admin passa sempre. Modulos com
   * adminOnly:true (configurado em APP_MODULES) exigem admin.
   */
  requireModule?: AppModuleId;
}

export function ProtectedRoute({ requireAdmin = false, requireModule }: ProtectedRouteProps) {
  const location = useLocation();
  const { currentUser, ready, canAccessModule } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="glass-card px-6 py-4 text-sm text-muted-foreground">
          Carregando acesso...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && currentUser.role !== "admin") {
    return <Navigate to="/mercado-livre" replace />;
  }

  if (requireModule && !canAccessModule(requireModule)) {
    // Sem permissao de modulo → redireciona pra fallback. Mercado Livre
    // continua sendo o fallback default; se o user nao tem nem isso,
    // cai pro / (Dashboard) que praticamente todos têm.
    const fallback = canAccessModule("ml") ? "/mercado-livre" : "/";
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
