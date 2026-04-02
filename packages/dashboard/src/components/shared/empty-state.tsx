import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  message?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function EmptyState({ message = "No data found", icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Icon className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
