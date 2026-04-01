import { Wrench } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export function SkillsPage() {
  return (
    <div>
      <PageHeader title="Skills" description="All skills across device groups" />
      <EmptyState message="Skills overview coming soon" icon={Wrench} />
    </div>
  );
}
