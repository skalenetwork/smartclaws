import {
    ArrowDownLeft,
    ArrowUpRight,
    Eye,
    LockKeyhole,
    Send,
    ShieldX,
    UserMinus,
    UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Address } from "viem";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChannelInfo, subjectPath } from "@/hooks/use-channel-directory";
import type { FailedReadAttempt } from "@/hooks/use-failed-read-attempts";
import type { ActivityEvent, ActivityKind } from "@/hooks/use-network-activity";
import type { Sender, SenderLabels } from "@/hooks/use-senders";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

const MAX_ROWS = 40;

type FeedKind = ActivityKind | "refused";

interface FeedItem {
    id: string;
    kind: FeedKind;
    channel: Address;
    timestamp: number;
    offset?: number;
    reader?: Address;
    reason?: string;
}

const KIND_STYLE: Record<FeedKind, { icon: typeof Send; tint: string }> = {
    published: { icon: Send, tint: "bg-muted text-muted-foreground" },
    disclosed: { icon: Eye, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
    "reader-added": {
        icon: UserPlus,
        tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    "reader-removed": { icon: UserMinus, tint: "bg-red-500/10 text-red-600 dark:text-red-400" },
    refused: { icon: ShieldX, tint: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

function Name({ children, title }: { children: string; title?: string }) {
    return (
        <span className="font-medium text-foreground" title={title}>
            {children}
        </span>
    );
}

/**
 * Leads with whoever acted. Agents publish and read; a grant or revoke is a change to the
 * channel's reader list, so the channel leads those.
 */
function Sentence({
    item,
    channel,
    sender,
    senders,
}: {
    item: FeedItem;
    channel: ChannelInfo | undefined;
    sender: Sender;
    senders: SenderLabels;
}) {
    const subject = <Name>{channel?.subject.name ?? "an unknown channel"}</Name>;
    const reader = (
        <Name title={item.reader}>
            {item.reader ? senders.wallet(item.reader).name : "an unknown reader"}
        </Name>
    );
    const message = item.offset === undefined ? "a message" : `#${item.offset}`;
    switch (item.kind) {
        case "published":
            return (
                <>
                    <Name title={sender.wallet}>{sender.name}</Name> published {message} to{" "}
                    {subject}
                </>
            );
        case "disclosed":
            return (
                <>
                    {reader} read {message} from {subject}
                </>
            );
        case "reader-added":
            return (
                <>
                    {subject} granted read access to {reader}
                </>
            );
        case "reader-removed":
            return (
                <>
                    {subject} revoked read access from {reader}
                </>
            );
        case "refused":
            return (
                <>
                    {reader} was refused {message} on {subject}
                </>
            );
    }
}

function FeedRow({
    item,
    channel,
    sender,
    senders,
}: {
    item: FeedItem;
    channel: ChannelInfo | undefined;
    sender: Sender;
    senders: SenderLabels;
}) {
    const { icon: Icon, tint } = KIND_STYLE[item.kind];
    const Direction = channel?.direction === "incoming" ? ArrowDownLeft : ArrowUpRight;
    const content = (
        <>
            <span
                className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    tint,
                )}
            >
                <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground">
                    <Sentence item={item} channel={channel} sender={sender} senders={senders} />
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground/80">
                    {item.kind === "refused" ? (
                        <span className="truncate text-red-600 dark:text-red-400">
                            {item.reason}
                        </span>
                    ) : (
                        <>
                            <Direction className="size-3" aria-hidden="true" />
                            {channel?.direction === "incoming" ? "Incoming" : "Outgoing"} channel
                            {channel?.kind === "encrypted" && (
                                <LockKeyhole className="ml-1 size-3" aria-label="encrypted" />
                            )}
                        </>
                    )}
                </p>
            </div>
            <time
                dateTime={new Date(item.timestamp * 1000).toISOString()}
                title={new Date(item.timestamp * 1000).toLocaleString()}
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
            >
                {timeAgo(item.timestamp).label}
            </time>
        </>
    );

    const rowClass =
        "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none";
    if (!channel) return <div className={rowClass}>{content}</div>;
    return (
        <Link
            to={subjectPath(channel.subject, channel.direction)}
            state={{ channelKind: channel.kind }}
            className={rowClass}
        >
            {content}
        </Link>
    );
}

type Filter = "all" | "access";

interface ActivityFeedProps {
    events: ActivityEvent[];
    refused: FailedReadAttempt[];
    channels: Map<string, ChannelInfo>;
    senders: SenderLabels;
    senderByChannel: Map<string, Sender>;
    isLoading: boolean;
    className?: string;
}

/** Newest events across every channel; each row opens the channel it happened in. */
export function ActivityFeed({
    events,
    refused,
    channels,
    senders,
    senderByChannel,
    isLoading,
    className,
}: ActivityFeedProps) {
    const [filter, setFilter] = useState<Filter>("all");

    const items = useMemo(() => {
        const merged: FeedItem[] = [
            ...events.map((event) => ({ ...event })),
            ...refused.map((attempt) => ({
                id: `${attempt.txHash}:refused`,
                kind: "refused" as const,
                channel: attempt.channel,
                timestamp: attempt.timestamp ?? 0,
                offset: attempt.offset,
                reader: attempt.reader,
                reason: attempt.reason,
            })),
        ];
        return merged
            .filter((item) => filter === "all" || item.kind !== "published")
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_ROWS);
    }, [events, refused, filter]);

    return (
        <section
            aria-labelledby="feed-heading"
            className={cn("flex flex-col rounded-xl border bg-card shadow-sm", className)}
        >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <h2 id="feed-heading" className="text-sm font-semibold">
                    Latest activity
                </h2>
                <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
                    {(
                        [
                            ["all", "Everything"],
                            ["access", "Reads and access"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={filter === value}
                            onClick={() => setFilter(value)}
                            className={cn(
                                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                                filter === value
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-3 p-4">
                    {["a", "b", "c", "d", "e"].map((key) => (
                        <Skeleton key={key} className="h-10 rounded-lg" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <div className="px-4 py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                        {filter === "all"
                            ? "No channel activity in the last 24 hours."
                            : "No reads, grants or refusals in the last 24 hours."}
                    </p>
                    {filter === "access" && (
                        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground/70">
                            Request a disclosure from an encrypted channel and it shows up here.
                        </p>
                    )}
                </div>
            ) : (
                <ul className="max-h-[560px] divide-y divide-border/60 overflow-y-auto">
                    {items.map((item) => (
                        <li key={item.id}>
                            <FeedRow
                                item={item}
                                channel={channels.get(item.channel.toLowerCase())}
                                sender={
                                    senderByChannel.get(item.channel.toLowerCase()) ??
                                    senders.channel(undefined)
                                }
                                senders={senders}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
