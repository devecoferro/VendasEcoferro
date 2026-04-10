import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExtractionProvider } from "@/contexts/ExtractionContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

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

                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/review" element={<ReviewPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/mercado-livre" element={<MercadoLivrePage />} />
                  <Route path="/mercado-livre-fantom" element={<MercadoLivreFantomPage />} />
                  <Route path="/mercado-livre/reconnect" element={<MLReconnectPage />} />
                  <Route path="/stock" element={<StockPage />} />
                </Route>

                <Route element={<ProtectedRoute requireAdmin />}>
                  <Route path="/users" element={<UsersPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </ExtractionProvider>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
