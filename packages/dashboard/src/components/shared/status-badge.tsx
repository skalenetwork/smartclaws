import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  active: boolean;
}

export function StatusBadge({ active }: StatusBadgeProps) {
  return (
    <Badge variant="glass" className="text-xs gap-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          active ? "bg-accent-emerald" : "bg-muted-foreground/40",
        )}
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}
