import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface SidebarNavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  logoSrc?: string;
  logoAlt?: string;
}

interface SidebarContentProps {
  collapsed: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
}

const baseNavItems: SidebarNavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/review", icon: ClipboardCheck, label: "Conferencia" },
  { to: "/history", icon: History, label: "Historico" },
  { to: "/stock", icon: Package, label: "Estoque" },
  {
    to: "/mercado-livre",
    label: "EcoFerro",
    logoSrc: "/menu-ecoferro-logo-96.png",
    logoAlt: "Logo EcoFerro",
  },
  {
    to: "/mercado-livre-fantom",
    label: "Fantom",
    logoSrc: "/menu-fantom-logo-96.png",
    logoAlt: "Logo Fantom",
  },
];

function SidebarContent({
  collapsed,
  mobile = false,
  onNavigate,
  onToggleCollapsed,
}: SidebarContentProps) {
  const location = useLocation();
  const { currentUser, logout } = useAuth();

  const navItems = useMemo(() => {
    if (currentUser?.role === "admin") {
      return [...baseNavItems, { to: "/users", icon: ShieldCheck, label: "Usuarios" }];
    }

    return baseNavItems;
  }, [currentUser?.role]);

  return (
    <div
      className={cn(
        "sidebar-gradient relative flex h-full flex-col",
        mobile
          ? "w-[290px] max-w-[84vw] border-r border-sidebar-border"
          : "border-r border-sidebar-border"
      )}
    >
      <div className="flex items-center gap-3 border-b border-sidebar-border/80 px-4 py-5 sm:px-5">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-sidebar-border/40">
          <img
            src="/menu-ecoferro-logo-96.png"
            alt="Logo EcoFerro"
            width={32}
            height={32}
            className="h-7 w-7 object-contain"
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        {!collapsed && (
          <div className="min-w-0 animate-slide-in">
            <h1 className="truncate text-[15px] font-bold tracking-tight text-sidebar-foreground">
              EcoFerro
            </h1>
            <p className="truncate text-[11px] uppercase tracking-[0.14em] text-sidebar-foreground/50">
              Vendas · Etiquetas
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.to ||
            (item.to !== "/" && location.pathname.startsWith(`${item.to}/`));

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/20 text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-border/40 hover:text-sidebar-foreground"
              )}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
                />
              )}
              {item.logoSrc ? (
                <span
                  className={cn(
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5 shadow-sm",
                    isActive && "ring-1 ring-white/40"
                  )}
                >
                  <img
                    src={item.logoSrc}
                    alt={item.logoAlt ?? item.label}
                    width={24}
                    height={24}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="h-full w-full object-contain"
                  />
                </span>
              ) : (
                item.icon && (
                  <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive && "text-accent")} />
                )
              )}
              {!collapsed && <span className="animate-slide-in">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {!mobile && (
        <button
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-sm transition-colors hover:bg-secondary"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-foreground" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5 text-foreground" />
          )}
        </button>
      )}

      <div className="space-y-3 border-t border-sidebar-border/80 px-3 py-4 sm:px-4">
        {currentUser && !collapsed && (
          <div className="animate-slide-in flex items-center gap-2.5 rounded-xl border border-sidebar-border/60 bg-white/[0.04] px-3 py-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/60 to-accent/60 text-[11px] font-semibold uppercase text-primary-foreground">
              {currentUser.username?.slice(0, 2) || "??"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-sidebar-foreground">
                {currentUser.username}
              </p>
              <p className="truncate text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">
                {currentUser.role === "admin" ? "Administrador" : "Operador"}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            onNavigate?.();
            void logout();
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-border/50 hover:text-sidebar-foreground",
            collapsed && "justify-center px-2"
          )}
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
          {!collapsed && <span className="animate-slide-in">Sair</span>}
        </button>
      </div>
    </div>
  );
}

export function AppSidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        // Sticky no desktop: a pagina rola no body e a sidebar fica fixa,
        // dando a unica barra de rolagem no canto direito do navegador.
        mobile ? "h-full" : "sticky top-0 hidden h-screen shrink-0 md:flex",
        !mobile && (collapsed ? "w-[72px]" : "w-[240px]")
      )}
    >
      <SidebarContent
        collapsed={mobile ? false : collapsed}
        mobile={mobile}
        onNavigate={onNavigate}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
      />
    </aside>
  );
}
