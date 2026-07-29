import { Badge } from "@/components/ui/badge";

interface SkillChipsProps {
    skills: string;
}

export function SkillChips({ skills }: SkillChipsProps) {
    const items = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (items.length === 0) {
        return <span className="text-sm text-muted-foreground">No skills defined</span>;
    }

    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((skill) => (
                <Badge key={skill} variant="glass" className="text-xs">
                    {skill}
                </Badge>
            ))}
        </div>
    );
}
