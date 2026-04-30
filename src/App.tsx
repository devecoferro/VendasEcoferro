import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtractionProvider } from "@/contexts/ExtractionContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const MercadoLivrePage = lazy(() => import("./pages/MercadoLivrePage"));
const MercadoLivreFantomPage = lazy(() => import("./pages/MercadoLivreFantomPage"));
const MLCallbackPage = lazy(() => import("./pages/MLCallbackPage"));
const MLReconnectPage = lazy(() => import("./pages/MLReconnectPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const StockPage = lazy(() => import("./pages/StockPage"));
const ConferenciaVendaPage = lazy(() => import("./pages/ConferenciaVendaPage"));
const MLDiagnosticsPage = lazy(() => import("./pages/MLDiagnosticsPage"));
const ManualPage = lazy(() => import("./pages/ManualPage"));
const ReportDebugPage = lazy(() => import("./pages/ReportDebugPage"));
const AdminHealthPage = lazy(() => import("./pages/AdminHealthPage"));
const AdminSecurityPage = lazy(() => import("./pages/AdminSecurityPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="glass-card px-6 py-4 text-sm text-muted-foreground">
        Carregando painel...
      </div>
    </div>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <ExtractionProvider>
                <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/ml-callback" element={<MLCallbackPage />} />

                {/* 2026-04-30: cada rota declara o moduleId que exige.
                    Admin passa sempre; operator precisa ter o modulo
                    em allowedModules (ou "*"). Reconnect ML é livre
                    pra qualquer usuario logado (path utilitario). */}
                <Route element={<ProtectedRoute requireModule="dashboard" />}>
                  <Route path="/" element={<DashboardPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="review" />}>
                  <Route path="/review" element={<ReviewPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="history" />}>
                  <Route path="/history" element={<HistoryPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="ml" />}>
                  <Route path="/mercado-livre" element={<MercadoLivrePage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="fantom" />}>
                  <Route path="/mercado-livre-fantom" element={<MercadoLivreFantomPage />} />
                </Route>
                <Route element={<ProtectedRoute />}>
                  <Route path="/mercado-livre/reconnect" element={<MLReconnectPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="stock" />}>
                  <Route path="/stock" element={<StockPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="conferencia_venda" />}>
                  <Route path="/conferencia-venda" element={<ConferenciaVendaPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="manual" />}>
                  <Route path="/manual" element={<ManualPage />} />
                </Route>
                <Route element={<ProtectedRoute requireModule="report_debug" />}>
                  <Route path="/report-debug" element={<ReportDebugPage />} />
                </Route>

                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/ml-diagnostics" element={<MLDiagnosticsPage />} />
                  <Route path="/admin/health" element={<AdminHealthPage />} />
                  <Route path="/admin/security" element={<AdminSecurityPage />} />
                </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </ExtractionProvider>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
