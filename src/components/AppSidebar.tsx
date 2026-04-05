import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
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
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-5 sm:px-5 sm:py-6">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg gradient-primary">
          <FileText className="h-5 w-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="min-w-0 animate-slide-in">
            <h1 className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
              Gerador de
            </h1>
            <p className="truncate text-xs text-sidebar-foreground/60">Etiquetas PDF</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
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
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/20 text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-border/50 hover:text-sidebar-foreground"
              )}
            >
              {item.logoSrc ? (
                <span
                  className={cn(
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5 shadow-sm",
                    isActive && "ring-1 ring-white/30"
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
                  <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive && "text-accent")} />
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

      <div className="space-y-3 border-t border-sidebar-border px-4 py-4 sm:px-5">
        {currentUser && !collapsed && (
          <div className="animate-slide-in rounded-xl border border-sidebar-border/60 bg-white/5 p-3">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">
              {currentUser.username}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/50">
              {currentUser.role === "admin" ? "Administrador" : "Operador"}
            </p>
          </div>
        )}

        <button
          onClick={() => {
            onNavigate?.();
            void logout();
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-border/50 hover:text-sidebar-foreground",
            collapsed && "justify-center px-2"
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span className="animate-slide-in">Sair</span>}
        </button>

        {!collapsed && (
          <p className="animate-slide-in text-[10px] text-sidebar-foreground/40">
            v1.0 | Mercado Livre Tools
          </p>
        )}
      </div>
    </div>
  );
}

export function AppSidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        mobile ? "h-full" : "hidden h-screen md:flex",
        !mobile && (collapsed ? "w-[72px]" : "w-[260px]")
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
