import { Wrench } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

interface SkillsViewProps {
    skills: string;
}

export function SkillsView({ skills }: SkillsViewProps) {
    if (!skills) {
        return <EmptyState message="No skills defined for this group" icon={Wrench} />;
    }

    const skillList = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                {skillList.length} skill{skillList.length !== 1 ? "s" : ""} defined
            </p>
            <div className="flex flex-wrap gap-2">
                {skillList.map((skill) => (
                    <div
                        key={skill}
                        className="flex items-center gap-1.5 bg-card border rounded-lg px-3 py-2 text-sm"
                    >
                        <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                        {skill}
                    </div>
                ))}
            </div>
        </div>
    );
}
