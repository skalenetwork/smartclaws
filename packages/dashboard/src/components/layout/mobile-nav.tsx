import { Cpu, KeyRound, Layers, LayoutDashboard, Rocket, Wrench } from "lucide-react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/utils";

const items = [
    { to: "/overview", label: "Overview", icon: LayoutDashboard },
    { to: "/groups", label: "Groups", icon: Layers },
    { to: "/agents", label: "Agents", icon: Cpu },
    { to: "/access", label: "Access", icon: KeyRound },
    { to: "/skills", label: "Skills", icon: Wrench },
    { to: "/setup", label: "Setup", icon: Rocket },
];

export function MobileNav() {
    const location = useLocation();

    return (
        <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 md:hidden">
            <div className="flex items-center gap-1 rounded-full border border-border/50 bg-background/60 backdrop-blur-xl px-2 py-2 shadow-lg">
                {items.map(({ to, label, icon: Icon }) => {
                    const isActive = location.pathname.startsWith(to);
                    return (
                        <Link
                            key={to}
                            to={to}
                            className={cn(
                                "flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-xs transition-colors min-w-16",
                                isActive ? "text-foreground bg-accent/60" : "text-muted-foreground",
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
