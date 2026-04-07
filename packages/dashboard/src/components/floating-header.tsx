import { Link } from "react-router";
import { LayoutDashboard, Rocket } from "lucide-react";

const items = [
  { to: "/overview", label: "Dashboard", icon: LayoutDashboard },
  { to: "/setup", label: "Setup", icon: Rocket },
];

export function FloatingHeader() {
  return (
    <header className="fixed top-4 right-4 z-50">
      <nav className="flex items-center gap-1 rounded-full border border-border/50 bg-background/60 backdrop-blur-xl px-2 py-1.5 shadow-lg">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
