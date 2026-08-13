import { ArrowDownLeft, ArrowLeft, ArrowUpRight, KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Address } from "viem";
import { AccessPanel } from "@/components/shared/access-panel";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { ChannelAddressBar } from "@/components/shared/channel-address-bar";
import { ChannelView } from "@/components/shared/channel-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgentDetail } from "@/hooks/use-agent-detail";
import { useAgentLiveness } from "@/hooks/use-agent-liveness";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

export function AgentDetailPage() {
    const { address } = useParams<{ address: string }>();
    if (!address) return null;

    // Key forces full remount when navigating between agents
    return <AgentDetailContent key={address} address={address as Address} />;
}

function AgentDetailContent({ address }: { address: Address }) {
    const {
        agentId,
        metadata,
        active,
        incomingChannel,
        outgoingChannel,
        lastMessageTs,
        isLoading,
    } = useAgentDetail(address);
    const { liveness } = useAgentLiveness();
    const live = liveness[address] ?? {};
    const [activeTab, setActiveTab] = useState("outgoing");

    // `access` is not a channel tab, so no address bar is shown for it.
    const activeChannel =
        activeTab === "outgoing"
            ? outgoingChannel
            : activeTab === "incoming"
              ? incomingChannel
              : undefined;

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

    // Prefer owner-attributed activity; fall back to the agent audit channel.
    const freshness = timeAgo(live.lastActivityTs ?? lastMessageTs);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <Link
                    to="/agents"
                    className="bg-muted/50 hover:bg-muted text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                    title="Back to agents"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                </Link>
                <AddressAvatar address={address} size={36} kind="agent" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-lg font-semibold">{agentId || "Agent"}</h1>
                        <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                            Agent
                        </Badge>
                        <Badge
                            variant={active ? "secondary" : "outline"}
                            className="px-2 py-0.5 text-[10px]"
                        >
                            {active ? "Active" : "Deactivated"}
                        </Badge>
                        {(live.lastActivityTs ?? lastMessageTs) !== undefined && (
                            <span
                                title={
                                    live.source
                                        ? `last activity via ${live.source}`
                                        : "last message on agent channel"
                                }
                                className={cn(
                                    "rounded-full px-2 py-0.5 text-[10px]",
                                    timeAgoColors[freshness.color],
                                )}
                            >
                                {freshness.label}
                                {live.source ? ` · ${live.source}` : ""}
                            </span>
                        )}
                    </div>
                    <p className="text-muted-foreground/80 truncate text-xs">{address}</p>
                </div>
            </div>

            {metadata && (
                <Card>
                    <CardContent className="text-muted-foreground py-2.5 text-xs">
                        {metadata}
                    </CardContent>
                </Card>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex items-center justify-between">
                    <TabsList>
                        <TabsTrigger value="outgoing">
                            <ArrowUpRight className="h-4 w-4" />
                            Outgoing Channel
                        </TabsTrigger>
                        <TabsTrigger value="incoming">
                            <ArrowDownLeft className="h-4 w-4" />
                            Incoming Channel
                        </TabsTrigger>
                        <TabsTrigger value="access">
                            <KeyRound className="h-4 w-4" />
                            Access
                        </TabsTrigger>
                    </TabsList>
                </div>

                {activeChannel && <ChannelAddressBar address={activeChannel} />}

                <TabsContent value="outgoing">
                    {outgoingChannel ? (
                        <ChannelView address={outgoingChannel} variant="compact" />
                    ) : (
                        <Card>
                            <CardContent className="text-muted-foreground py-12 text-center text-sm">
                                No outgoing channel configured
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="incoming">
                    {incomingChannel ? (
                        <ChannelView address={incomingChannel} variant="compact" />
                    ) : (
                        <Card>
                            <CardContent className="text-muted-foreground py-12 text-center text-sm">
                                No incoming channel configured
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="access">
                    <AccessPanel subject={address} kind="agent" />
                </TabsContent>
            </Tabs>
        </div>
    );
}
