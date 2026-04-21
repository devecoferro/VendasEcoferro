import { type ReactNode, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface AppLayoutProps {
  children: ReactNode;
}

const ROUTE_TITLES: Array<{ match: RegExp; title: string }> = [
  { match: /^\/$/, title: "Dashboard" },
  { match: /^\/review/, title: "Conferencia" },
  { match: /^\/conferencia-venda/, title: "Conferencia Venda" },
  { match: /^\/history/, title: "Historico" },
  { match: /^\/mercado-livre-fantom/, title: "Fantom" },
  { match: /^\/mercado-livre/, title: "EcoFerro" },
  { match: /^\/stock/, title: "Estoque" },
  { match: /^\/manual/, title: "Manual" },
  { match: /^\/report-debug/, title: "Report Debug" },
  { match: /^\/users/, title: "Usuarios" },
  { match: /^\/ml-diagnostics/, title: "Diagnostico ML" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentTitle = useMemo(() => {
    return ROUTE_TITLES.find((entry) => entry.match.test(location.pathname))?.title || "Painel";
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-background md:flex">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">EcoFerro</p>
            <h1 className="truncate text-base font-semibold text-foreground">{currentTitle}</h1>
          </div>

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Abrir menu"
                className="h-10 w-10 shrink-0 rounded-xl"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Abrir menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-auto border-0 bg-transparent p-0 shadow-none">
              <AppSidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>

        {/* Scroll nativo do navegador — sidebar fica sticky e uma unica barra
            de rolagem aparece no canto direito (comportamento web padrao,
            evita scroll aninhado dentro de listas virtualizadas). */}
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
