import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { AddressAvatar } from "@/components/shared/address-avatar";
import type { ActivityEvent } from "@/hooks/use-network-activity";
import type { UnregisteredAgent } from "@/hooks/use-senders";
import { getExplorerAddressUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";

interface UnregisteredAgentsProps {
    agents: UnregisteredAgent[];
    events: ActivityEvent[];
    className?: string;
}

/**
 * The key to the "Unregistered N" labels used across the overview: which wallet each one is,
 * and what it writes.
 */
export function UnregisteredAgents({ agents, events, className }: UnregisteredAgentsProps) {
    const { address: viewer } = useAccount();

    const publishedByChannel = useMemo(() => {
        const counts = new Map<string, number>();
        for (const event of events) {
            if (event.kind !== "published") continue;
            const key = event.channel.toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }, [events]);

    if (agents.length === 0) return null;

    return (
        <section
            aria-labelledby="unregistered-heading"
            className={cn("rounded-xl border bg-card shadow-sm", className)}
        >
            <div className="border-b px-4 py-3">
                <h2 id="unregistered-heading" className="text-sm font-semibold">
                    Unregistered agents
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    Wallets that write to channels without an agent contract
                </p>
            </div>
            <ul className="divide-y divide-border/60">
                {agents.map((agent) => {
                    const explorerUrl = getExplorerAddressUrl(agent.wallet);
                    const published = agent.channels.reduce(
                        (sum, channel) =>
                            sum + (publishedByChannel.get(channel.address.toLowerCase()) ?? 0),
                        0,
                    );
                    const isViewer = viewer?.toLowerCase() === agent.wallet.toLowerCase();
                    return (
                        <li key={agent.wallet} className="flex items-center gap-3 px-4 py-2.5">
                            <AddressAvatar address={agent.wallet} size={28} kind="agent" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">
                                    {agent.name}
                                    {isViewer && (
                                        <span className="font-normal text-muted-foreground">
                                            {" "}
                                            (you)
                                        </span>
                                    )}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                                    Writes to{" "}
                                    {agent.channels
                                        .map(
                                            (channel) =>
                                                `${channel.subject.name}${channel.direction === "incoming" ? " (incoming)" : ""}`,
                                        )
                                        .join(", ")}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-xs tabular-nums">
                                    {published} {published === 1 ? "message" : "messages"}
                                </p>
                                {explorerUrl ? (
                                    <a
                                        href={explorerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={agent.wallet}
                                        aria-label={`View ${agent.name} in explorer`}
                                        className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        {agent.wallet.slice(0, 6)}…{agent.wallet.slice(-4)}
                                        <ExternalLink className="size-3" aria-hidden="true" />
                                    </a>
                                ) : (
                                    <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                        {agent.wallet.slice(0, 6)}…{agent.wallet.slice(-4)}
                                    </span>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
