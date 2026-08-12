import { Cpu } from "lucide-react";
import { Link } from "react-router";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type AgentInfo, useAgents } from "@/hooks/use-agents";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

const dotColors = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    muted: "bg-muted-foreground/40",
} as const;

function AgentRow({ agent }: { agent: AgentInfo }) {
    const freshness = timeAgo(agent.lastMessageTs);

    return (
        <Link to={`/agents/${agent.address}`} className="block">
            <Card className="hover:border-foreground/20 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                    <AddressAvatar address={agent.address} size={28} kind="agent" />

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                                {agent.agentId ?? "Agent"}
                            </span>
                            {agent.active === false && (
                                <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
                                    Deactivated
                                </Badge>
                            )}
                        </div>
                        {agent.metadata && (
                            <p className="text-muted-foreground/80 truncate text-xs">
                                {agent.metadata}
                            </p>
                        )}
                    </div>

                    <span
                        className={cn(
                            "hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] sm:inline",
                            timeAgoColors[freshness.color],
                        )}
                    >
                        {freshness.label}
                    </span>

                    <span
                        title={`last message ${freshness.label}`}
                        className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            dotColors[freshness.color],
                        )}
                    />
                </CardContent>
            </Card>
        </Link>
    );
}

export function AgentsPage() {
    const { agents, activeCount, totalCount, isLoading } = useAgents();

    if (isLoading && agents.length === 0) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                title="Agents"
                description={
                    totalCount === 0
                        ? "No agents registered"
                        : `${activeCount} active of ${totalCount} registered`
                }
            />

            {agents.length === 0 ? (
                <EmptyState message="No agents registered in this registry" icon={Cpu} />
            ) : (
                <div className="space-y-2">
                    {agents.map((agent) => (
                        <AgentRow key={agent.address} agent={agent} />
                    ))}
                </div>
            )}
        </div>
    );
}
