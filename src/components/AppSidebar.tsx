import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, ClipboardCheck, History, FileText, ChevronLeft, ChevronRight, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Importação" },
  { to: "/review", icon: ClipboardCheck, label: "Conferência" },
  { to: "/history", icon: History, label: "Histórico" },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      className={cn(
        "sidebar-gradient flex flex-col border-r border-sidebar-border transition-all duration-300 relative",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-sidebar-border">
        <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
          <FileText className="w-5 h-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="animate-slide-in">
            <h1 className="text-sm font-bold text-sidebar-foreground tracking-tight">Gerador de</h1>
            <p className="text-xs text-sidebar-foreground/60">Etiquetas PDF</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/20 text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-border/50"
              )}
            >
              <item.icon className={cn("w-5 h-5 flex-shrink-0", isActive && "text-accent")} />
              {!collapsed && <span className="animate-slide-in">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center shadow-sm hover:bg-secondary transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5 text-foreground" />
        )}
      </button>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-sidebar-border">
        {!collapsed && (
          <p className="text-[10px] text-sidebar-foreground/40 animate-slide-in">v1.0 · Mercado Livre Tools</p>
        )}
      </div>
    </aside>
  );
}
