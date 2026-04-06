import { Home, LayoutDashboard, Box, Cpu, Wrench, Rocket, Radio, Monitor } from "lucide-react";
import { useLocation } from "react-router";
import logoSvg from "@/assets/logo.svg";
import { useHeaderActions } from "./header-context";

const routes: { path: string; label: string; icon: React.ElementType }[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/overview", label: "Overview", icon: LayoutDashboard },
  { path: "/groups", label: "Device Groups", icon: Box },
  { path: "/agents", label: "Agents", icon: Cpu },
  { path: "/skills", label: "Skills", icon: Wrench },
  { path: "/setup", label: "Setup", icon: Rocket },
  { path: "/channels", label: "Channel", icon: Radio },
  { path: "/devices", label: "Device", icon: Monitor },
];

function getRouteInfo(pathname: string) {
  return (
    routes.find((r) => r.path === pathname) ||
    routes.find((r) => r.path !== "/" && pathname.startsWith(r.path))
  );
}

export function Header() {
  const location = useLocation();
  const route = getRouteInfo(location.pathname);
  const Icon = route?.icon;
  const { actions } = useHeaderActions();

  return (
    <header className="flex items-center justify-between h-12 pl-4 pr-2 border-b border-border shrink-0 bg-background/80 backdrop-blur-xs">
      {/* Mobile: logo */}
      <div className="flex items-center gap-2.5 md:hidden">
        <img src={logoSvg} alt="SmartClaws" className="h-5 w-5" />
        <span className="font-semibold text-sm tracking-tight">SmartClaws</span>
      </div>

      {/* Desktop: icon + page name */}
      {route && (
        <div className="hidden md:flex items-center gap-2 text-sm">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{route.label}</span>
        </div>
      )}

      {/* Right side: page-specific actions */}
      {actions && <div className="hidden md:flex items-center">{actions}</div>}
    </header>
  );
}
