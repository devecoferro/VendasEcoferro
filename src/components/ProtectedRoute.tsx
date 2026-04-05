import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  requireAdmin?: boolean;
}

export function ProtectedRoute({ requireAdmin = false }: ProtectedRouteProps) {
  const location = useLocation();
  const { currentUser, ready } = useAuth();

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

  return <Outlet />;
}
