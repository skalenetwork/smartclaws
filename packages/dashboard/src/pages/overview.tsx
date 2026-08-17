import { StatCard } from "@/components/shared/stat-card";
import { BoxIcon } from "@/components/ui/box";
import { CpuIcon } from "@/components/ui/cpu";
import { RadioIcon } from "@/components/ui/radio";
import { useRegistryStats } from "@/hooks/use-registry-stats";

export function OverviewPage() {
    const { groupCount, agentCount, channelCount, isLoading } = useRegistryStats();

    return (
        <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                <StatCard
                    title="Device Groups"
                    value={groupCount !== undefined ? Number(groupCount) : undefined}
                    icon={BoxIcon}
                    accent="indigo"
                    isLoading={isLoading}
                />
                <StatCard
                    title="Agents"
                    value={agentCount !== undefined ? Number(agentCount) : undefined}
                    icon={CpuIcon}
                    accent="violet"
                    isLoading={isLoading}
                />
                <StatCard
                    title="Channels"
                    value={channelCount !== undefined ? Number(channelCount) : undefined}
                    icon={RadioIcon}
                    accent="amber"
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
}
