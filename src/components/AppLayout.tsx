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
  { match: /^\/history/, title: "Historico" },
  { match: /^\/mercado-livre-fantom/, title: "Fantom" },
  { match: /^\/mercado-livre/, title: "EcoFerro" },
  { match: /^\/stock/, title: "Estoque" },
  { match: /^\/users/, title: "Usuarios" },
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

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
