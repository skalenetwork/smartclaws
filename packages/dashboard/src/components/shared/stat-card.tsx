import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type AccentColor = "indigo" | "emerald" | "amber" | "violet";

const accentStyles: Record<AccentColor, { bg: string; icon: string }> = {
  indigo: {
    bg: "bg-indigo-50 dark:bg-indigo-700/30",
    icon: "text-indigo-500 dark:text-indigo-400",
  },
  emerald: {
    bg: "bg-emerald-50 dark:bg-emerald-700/30",
    icon: "text-emerald-500 dark:text-emerald-400",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-700/30",
    icon: "text-amber-500 dark:text-amber-400",
  },
  violet: {
    bg: "bg-violet-50 dark:bg-violet-700/30",
    icon: "text-violet-500 dark:text-violet-400",
  },
};

interface StatCardProps {
  title: string;
  value: number | string | undefined;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  accent?: AccentColor;
  isLoading?: boolean;
  children?: ReactNode;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  accent = "indigo",
  isLoading,
  children,
}: StatCardProps) {
  const styles = accentStyles[accent];

  return (
    <div className="bg-card rounded-lg border p-3 sm:p-3 sm:px-4 sm:pl-5 shadow-sm">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <div className="h-6 w-16 rounded bg-muted animate-pulse" />
          ) : (
            <div className="text-lg sm:text-xl font-bold text-foreground leading-tight">
              {value ?? 0}
            </div>
          )}
          <span className="text-[10px] sm:text-xs text-muted-foreground/80">{title}</span>
          {children}
        </div>
        <div className={cn("rounded-full p-1.5 sm:p-2.5 shrink-0", styles.bg)}>
          <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", styles.icon)} size={20} />
        </div>
      </div>
    </div>
  );
}
