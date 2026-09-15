import {
    Check,
    ChevronRight,
    ChevronsDown,
    Database,
    Eye,
    Hash,
    Loader2,
    LockKeyhole,
    LockKeyholeOpen,
    MessageSquare,
} from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { DisclosureLog } from "@/components/shared/disclosure-log";
import { EmptyState } from "@/components/shared/empty-state";
import { SensorCharts } from "@/components/shared/sensor-charts";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useChannelCapacity } from "@/hooks/use-channel-capacity";
import type { ChannelKind } from "@/hooks/use-channel-kind";
import { useChannelMessages } from "@/hooks/use-channel-messages";
import { usePublishTimes } from "@/hooks/use-publish-times";
import { useDisclose, useSessionRecords } from "@/hooks/use-viewer";
import { highlightJson } from "@/lib/json-highlight";
import type { DiscloseStage } from "@/lib/viewer/disclose";
import { decryptedKey } from "@/lib/viewer/session-records";

function formatBytes(bytes: bigint): string {
    const n = Number(bytes);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
}

function chainTimeIso(seconds: number | undefined): string | null {
    return seconds === undefined ? null : new Date(seconds * 1000).toISOString();
}

/**
 * When an encrypted message was added to the chain. Not the time inside the payload, which
 * is encrypted with it — the tooltip says so, since the two can differ.
 */
function ChainTime({ seconds, loading }: { seconds: number | undefined; loading: boolean }) {
    if (seconds === undefined) {
        return loading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-label="Looking up block time" />
        ) : (
            <span title="Added to the chain more than about six days ago; not looked up">—</span>
        );
    }
    return (
        <span title="When this message was added to the chain. The timestamp inside the payload is encrypted.">
            {formatTimestamp(seconds)}
        </span>
    );
}

const STAGE_LABEL: Record<DiscloseStage, string> = {
    confirm: "Confirm in wallet",
    requesting: "Requesting",
    decrypting: "Decrypting",
};

function compactJson(obj: Record<string, unknown>): ReactNode {
    const entries = Object.entries(obj);
    const visible = entries.slice(0, 4);
    return (
        <span>
            <span className="text-muted-foreground">{"{ "}</span>
            {visible.map(([k, v], i) => (
                <span key={k}>
                    <span className="text-sky-400">{k}</span>
                    <span className="text-muted-foreground">: </span>
                    {typeof v === "string" ? (
                        <span className="text-emerald-400">"{v}"</span>
                    ) : typeof v === "number" ? (
                        <span className="text-amber-400">{v}</span>
                    ) : typeof v === "boolean" ? (
                        <span className="text-violet-400">{String(v)}</span>
                    ) : v === null ? (
                        <span className="text-violet-400">null</span>
                    ) : (
                        <span className="text-muted-foreground">{JSON.stringify(v)}</span>
                    )}
                    {i < visible.length - 1 && <span className="text-muted-foreground">, </span>}
                </span>
            ))}
            {entries.length > 4 && <span className="text-muted-foreground">, …</span>}
            <span className="text-muted-foreground">{" }"}</span>
        </span>
    );
}

interface ChannelViewProps {
    address: Address;
    /**
     * `full` (default) shows sensor charts and the paging pill — useful for
     * device telemetry. `compact` shows only the capacity/storage/message stats
     * and the message list, with nothing between them.
     */
    variant?: "full" | "compact";
    channelKind?: ChannelKind;
}

export function ChannelView({
    address,
    variant = "full",
    channelKind: knownKind,
}: ChannelViewProps) {
    const isCompact = variant === "compact";
    const {
        messages,
        messageCount,
        maxCapacity,
        totalBytes,
        isLoading,
        isLoadingMore,
        canLoadMore,
        loadMore,
        channelKind,
        isEncrypted,
    } = useChannelMessages(address, 20, knownKind);
    const { hasPruned } = useChannelCapacity(address);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const { address: viewer } = useAccount();
    const { decrypted } = useSessionRecords(viewer);
    const { disclose, stages } = useDisclose(address);
    // Encrypted payloads carry their timestamp inside the ciphertext; the block is public.
    const encryptedOffsets = useMemo(
        () => messages.filter((msg) => msg.encrypted).map((msg) => msg.offset),
        [messages],
    );
    const publishTimes = usePublishTimes(address, encryptedOffsets, isEncrypted);

    const toggleExpand = (key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    if (isLoading && messages.length === 0) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    <Skeleton className="h-14 rounded-lg" />
                    <Skeleton className="h-14 rounded-lg" />
                    <Skeleton className="h-14 rounded-lg" />
                </div>
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

    const capacityPercent =
        maxCapacity !== undefined && totalBytes !== undefined && Number(maxCapacity) > 0
            ? Math.round((Number(totalBytes) / Number(maxCapacity)) * 100)
            : null;
    // #, Topic, Payload, Timestamp, [Actions], expand chevron
    const columnCount = isEncrypted ? 6 : 5;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <StatCard
                    title="Messages"
                    value={messageCount?.toString() ?? "0"}
                    icon={MessageSquare}
                    accent="indigo"
                />
                <StatCard
                    title={isEncrypted ? "Stored Ciphertext" : "Storage Used"}
                    value={totalBytes !== undefined ? formatBytes(totalBytes) : "0 B"}
                    icon={Database}
                    accent="amber"
                />
                <div className="bg-card rounded-lg border p-3 sm:p-3 sm:px-4 sm:pl-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3 sm:gap-4">
                        <div className="min-w-0 shrink-0">
                            <div className="text-lg sm:text-xl font-bold text-foreground leading-tight">
                                {capacityPercent !== null ? `${capacityPercent}%` : "N/A"}
                            </div>
                            <span className="text-[10px] sm:text-xs text-muted-foreground/80">
                                {isEncrypted ? "Ciphertext capacity" : "Capacity"}
                            </span>
                        </div>
                        {maxCapacity !== undefined && (
                            <div className="flex-1 min-w-0">
                                <div className="h-2 rounded-full bg-primary/20 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                                        style={{ width: `${Math.min(capacityPercent ?? 0, 100)}%` }}
                                    />
                                </div>
                                <p className="text-[10px] text-muted-foreground/60 mt-1">
                                    {totalBytes !== undefined ? formatBytes(totalBytes) : "0 B"} /{" "}
                                    {formatBytes(maxCapacity)}
                                    {hasPruned !== undefined && (
                                        <span
                                            title={
                                                hasPruned
                                                    ? "Circular buffer is evicting oldest messages — writes still succeed"
                                                    : "Nothing evicted yet; full history readable"
                                            }
                                        >
                                            {hasPruned ? " · pruning" : " · full history"}
                                        </span>
                                    )}
                                </p>
                            </div>
                        )}
                        <div className="rounded-full p-1.5 sm:p-2.5 shrink-0 bg-emerald-50 dark:bg-emerald-700/30">
                            <Hash
                                className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-500 dark:text-emerald-400"
                                size={20}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {!isCompact && messageCount !== undefined && messages.length > 0 && (
                <div className="flex justify-end">
                    <div className="bg-card inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5">
                        <span className="text-xs text-muted-foreground">
                            Showing{" "}
                            <span className="text-foreground font-medium">{messages.length}</span>
                            {" / "}
                            <span className="text-foreground font-medium">
                                {messageCount.toString()}
                            </span>
                        </span>
                        {canLoadMore && (
                            <button
                                type="button"
                                onClick={loadMore}
                                disabled={isLoadingMore}
                                className="ml-1 rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            >
                                {isLoadingMore ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <ChevronsDown className="h-3.5 w-3.5" />
                                )}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {!isCompact && <SensorCharts messages={messages} />}

            {messages.length === 0 ? (
                <EmptyState message="No messages in this channel" />
            ) : (
                <div className="rounded-xl border overflow-hidden bg-card shadow-sm">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16 px-3">#</TableHead>
                                <TableHead className="px-3">Topic</TableHead>
                                <TableHead className="px-3">Payload</TableHead>
                                <TableHead className="px-3">Timestamp</TableHead>
                                {isEncrypted && <TableHead className="px-3">Actions</TableHead>}
                                <TableHead className="w-10 px-3" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {messages.map((msg) => {
                                const key = msg.offset.toString();
                                const offset = Number(msg.offset);
                                const isExpanded = expanded.has(key);
                                const record = msg.encrypted
                                    ? decrypted[decryptedKey(address, offset)]
                                    : undefined;
                                const envelope = record ? record.envelope : msg.envelope;
                                const stage = stages[offset];
                                return (
                                    <Fragment key={key}>
                                        <TableRow
                                            className="cursor-pointer"
                                            onClick={() => toggleExpand(key)}
                                        >
                                            <TableCell className="py-2 px-3 text-xs text-muted-foreground">
                                                #{key}
                                            </TableCell>
                                            <TableCell className="py-2 px-3">
                                                <div className="flex items-center gap-1.5">
                                                    {msg.encrypted && !record ? (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            <LockKeyhole className="mr-1 h-3 w-3" />
                                                            Ciphertext
                                                        </Badge>
                                                    ) : envelope ? (
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-xs"
                                                        >
                                                            {envelope.topic}
                                                        </Badge>
                                                    ) : !record ? (
                                                        <Badge
                                                            variant="destructive"
                                                            className="text-xs"
                                                        >
                                                            {msg.error ?? "Raw"}
                                                        </Badge>
                                                    ) : null}
                                                    {record && (
                                                        <Badge
                                                            variant="outline"
                                                            className="border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400"
                                                            title="Disclosed to your wallet and decrypted in this tab"
                                                        >
                                                            <LockKeyholeOpen className="mr-1 h-3 w-3" />
                                                            Decrypted
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-2 px-3 text-xs font-mono text-muted-foreground max-w-72 truncate">
                                                {envelope
                                                    ? compactJson(envelope.p)
                                                    : record
                                                      ? record.text
                                                      : msg.encrypted
                                                        ? `${msg.ciphertextBytes ?? 0} bytes`
                                                        : `${msg.raw.slice(0, 40)}…`}
                                            </TableCell>
                                            <TableCell className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                                                {envelope ? (
                                                    formatTimestamp(envelope.ts)
                                                ) : msg.encrypted ? (
                                                    <ChainTime
                                                        seconds={publishTimes.timeOf(msg.offset)}
                                                        loading={publishTimes.isLoading}
                                                    />
                                                ) : (
                                                    "—"
                                                )}
                                            </TableCell>
                                            {isEncrypted && (
                                                <TableCell className="py-2 px-3">
                                                    {record ? (
                                                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                                            <Check className="h-3.5 w-3.5" />
                                                            Readable
                                                        </span>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="xs"
                                                            disabled={!!stage}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                void disclose(
                                                                    offset,
                                                                    msg.ciphertextBytes ?? 0,
                                                                );
                                                            }}
                                                        >
                                                            {stage ? (
                                                                <Loader2 className="animate-spin" />
                                                            ) : (
                                                                <Eye />
                                                            )}
                                                            {stage
                                                                ? STAGE_LABEL[stage]
                                                                : "Disclose"}
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            )}
                                            <TableCell className="py-2 px-3">
                                                <ChevronRight
                                                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                                />
                                            </TableCell>
                                        </TableRow>
                                        {isExpanded && (
                                            <TableRow className="hover:bg-transparent">
                                                <TableCell colSpan={columnCount} className="p-0">
                                                    {record && (
                                                        <p className="px-4 pt-2.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                                                            Decrypted in this tab · visible only to
                                                            you
                                                        </p>
                                                    )}
                                                    <pre className="text-xs font-mono bg-muted/30 rounded-lg p-3 m-2 overflow-x-auto leading-relaxed">
                                                        {highlightJson(
                                                            record
                                                                ? JSON.stringify(
                                                                      record.envelope ??
                                                                          record.text,
                                                                      null,
                                                                      2,
                                                                  )
                                                                : msg.encrypted
                                                                  ? JSON.stringify(
                                                                        {
                                                                            encrypted: true,
                                                                            addedToChainAt:
                                                                                chainTimeIso(
                                                                                    publishTimes.timeOf(
                                                                                        msg.offset,
                                                                                    ),
                                                                                ),
                                                                            ciphertextBytes:
                                                                                msg.ciphertextBytes,
                                                                            rawHex: msg.raw,
                                                                            channelKind,
                                                                        },
                                                                        null,
                                                                        2,
                                                                    )
                                                                  : msg.envelope
                                                                    ? JSON.stringify(
                                                                          msg.envelope,
                                                                          null,
                                                                          2,
                                                                      )
                                                                    : msg.raw,
                                                        )}
                                                    </pre>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>
                    {isCompact && messageCount !== undefined && (
                        <div className="flex items-center justify-between border-t px-3 py-2">
                            <span className="text-muted-foreground text-xs">
                                Showing{" "}
                                <span className="text-foreground font-medium">
                                    {messages.length}
                                </span>
                                {" / "}
                                <span className="text-foreground font-medium">
                                    {messageCount.toString()}
                                </span>
                            </span>
                            {canLoadMore && (
                                <button
                                    type="button"
                                    onClick={loadMore}
                                    disabled={isLoadingMore}
                                    className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {isLoadingMore ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <ChevronsDown className="h-3.5 w-3.5" />
                                    )}
                                    Load more
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isEncrypted && <DisclosureLog address={address} />}
        </div>
    );
}
