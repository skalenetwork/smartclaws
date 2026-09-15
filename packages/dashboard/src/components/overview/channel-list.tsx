import { ArrowDownLeft, ArrowUpRight, LockKeyhole } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChannelInfo, subjectPath } from "@/hooks/use-channel-directory";
import type { ActivityEvent } from "@/hooks/use-network-activity";
import type { Sender } from "@/hooks/use-senders";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

function plural(count: number, one: string, many: string) {
    return `${count} ${count === 1 ? one : many}`;
}

interface ChannelListProps {
    channels: ChannelInfo[];
    events: ActivityEvent[];
    senderByChannel: Map<string, Sender>;
    groupCount: number;
    isLoading: boolean;
    className?: string;
}

/** Every channel with its last 24 hours at a glance; each row opens that channel. */
export function ChannelList({
    channels,
    events,
    senderByChannel,
    groupCount,
    isLoading,
    className,
}: ChannelListProps) {
    const rows = useMemo(() => {
        const stats = new Map<string, { published: number; reads: number; last?: number }>();
        for (const event of events) {
            const key = event.channel.toLowerCase();
            const entry = stats.get(key) ?? { published: 0, reads: 0 };
            if (event.kind === "published") entry.published += 1;
            if (event.kind === "disclosed") entry.reads += 1;
            // Events arrive newest first, so the first one seen is the latest.
            entry.last ??= event.timestamp;
            stats.set(key, entry);
        }
        return [...channels]
            .sort(
                (a, b) =>
                    a.subject.name.localeCompare(b.subject.name) ||
                    a.direction.localeCompare(b.direction) * -1,
            )
            .map((channel) => ({
                channel,
                stats: stats.get(channel.address.toLowerCase()) ?? { published: 0, reads: 0 },
            }));
    }, [channels, events]);

    const devices = new Set(
        channels.filter((c) => c.subject.kind === "device").map((c) => c.subject.address),
    ).size;
    const agents = new Set(
        channels.filter((c) => c.subject.kind === "agent").map((c) => c.subject.address),
    ).size;

    return (
        <section
            aria-labelledby="channels-heading"
            className={cn("flex flex-col rounded-xl border bg-card shadow-sm", className)}
        >
            <div className="border-b px-4 py-3">
                <h2 id="channels-heading" className="text-sm font-semibold">
                    Channels
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    {plural(groupCount, "group", "groups")}, {plural(devices, "device", "devices")},{" "}
                    {plural(agents, "agent", "agents")}
                </p>
            </div>

            {isLoading && rows.length === 0 ? (
                <div className="space-y-3 p-4">
                    {["a", "b", "c", "d"].map((key) => (
                        <Skeleton key={key} className="h-10 rounded-lg" />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No channels registered yet.
                </p>
            ) : (
                <ul className="divide-y divide-border/60">
                    {rows.map(({ channel, stats }) => {
                        const Direction =
                            channel.direction === "incoming" ? ArrowDownLeft : ArrowUpRight;
                        const ago = timeAgo(stats.last);
                        const sender = senderByChannel.get(channel.address.toLowerCase());
                        const writer =
                            sender && sender.key !== "unknown" && !sender.key.startsWith("none:")
                                ? sender
                                : undefined;
                        return (
                            <li key={channel.address}>
                                <Link
                                    to={subjectPath(channel.subject, channel.direction)}
                                    state={{ channelKind: channel.kind }}
                                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                                >
                                    <AddressAvatar
                                        address={channel.subject.address}
                                        size={28}
                                        kind={channel.subject.kind}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                            {channel.subject.name}
                                        </p>
                                        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground/80">
                                            <Direction
                                                className="size-3 shrink-0"
                                                aria-hidden="true"
                                            />
                                            {channel.direction === "incoming"
                                                ? "Incoming"
                                                : "Outgoing"}
                                            {channel.kind === "encrypted" && (
                                                <LockKeyhole
                                                    className="ml-1 size-3 shrink-0"
                                                    aria-label="encrypted"
                                                />
                                            )}
                                            {writer && (
                                                <span
                                                    className="ml-1 truncate"
                                                    title={writer.wallet}
                                                >
                                                    by {writer.name}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="text-xs tabular-nums">
                                            {plural(stats.published, "message", "messages")}
                                            {stats.reads > 0 && (
                                                <span className="text-muted-foreground">
                                                    , {plural(stats.reads, "read", "reads")}
                                                </span>
                                            )}
                                        </p>
                                        <span
                                            className={cn(
                                                "mt-0.5 inline-flex rounded-full px-1.5 py-px text-[10px]",
                                                timeAgoColors[stats.last ? ago.color : "muted"],
                                            )}
                                        >
                                            {stats.last ? ago.label : "quiet today"}
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
