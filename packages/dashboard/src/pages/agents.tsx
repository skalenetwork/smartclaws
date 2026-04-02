import { Cpu } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export function AgentsPage() {
  return (
    <div>
      <PageHeader title="Agents" description="Agent support coming soon" />
      <EmptyState message="Agent pages are not yet implemented" icon={Cpu} />
    </div>
  );
}
