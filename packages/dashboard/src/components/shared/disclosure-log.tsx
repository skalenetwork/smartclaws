import {
    Check,
    ChevronRight,
    Copy,
    ExternalLink,
    Eye,
    Loader2,
    LockKeyholeOpen,
    RotateCw,
    UserMinus,
    UserPlus,
    XCircle,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AddressBadge } from "@/components/shared/address-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { type DisclosureEntry, useDisclosureLog } from "@/hooks/use-disclosure-log";
import { useFailedReadAttempts } from "@/hooks/use-failed-read-attempts";
import { useSessionRecords, useViewKey } from "@/hooks/use-viewer";
import { getExplorerTxUrl } from "@/lib/explorer";
import { highlightJson } from "@/lib/json-highlight";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";
import { type DecryptedMessage, decryptedKey, openDisclosure } from "@/lib/viewer/session-records";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

/**
 * One row of the log. Event-log entries come from the RPC scan; failed attempts emit no
 * events, so they come from the explorer or from this tab's own requests, and may not
 * know their reader.
 */
type LogRow = Omit<DisclosureEntry, "kind" | "reader"> & {
    kind: DisclosureEntry["kind"] | "rejected" | "callback-failed";
    reader?: Address;
    reason?: string;
};

function EventCell({ row, decrypted }: { row: LogRow; decrypted: boolean }) {
    if (row.kind === "rejected" || row.kind === "callback-failed") {
        return (
            <div>
                <Badge variant="destructive" className="gap-1.5">
                    <XCircle />
                    {row.kind === "rejected" ? "Read rejected" : "Callback failed"}
                </Badge>
                {row.reason && (
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                        {row.reason}
                    </span>
                )}
            </div>
        );
    }
    if (row.kind === "disclosure") {
        return (
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="gap-1.5">
                    <Eye className="text-sky-500 dark:text-sky-400" />
                    Disclosed
                </Badge>
                {decrypted && (
                    <Badge
                        variant="outline"
                        className="gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    >
                        <LockKeyholeOpen />
                        Decrypted
                    </Badge>
                )}
            </div>
        );
    }
    if (row.kind === "reader-added") {
        return (
            <Badge variant="secondary" className="gap-1.5">
                <UserPlus className="text-emerald-500 dark:text-emerald-400" />
                Reader granted
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="gap-1.5">
            <UserMinus className="text-red-500 dark:text-red-400" />
            Reader revoked
        </Badge>
    );
}

/**
 * The re-encrypted payload exactly as the contract emitted it. Sealed to the reader's
 * key — this shows what travelled, not what it says.
 */
function CiphertextPanel({ row }: { row: LogRow }) {
    const [copied, setCopied] = useState(false);

    function handleCopy() {
        if (!row.ciphertext) return;
        navigator.clipboard.writeText(row.ciphertext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="m-2 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
                <span className="text-[11px] text-muted-foreground/70">
                    Disclosed ciphertext · re-encrypted to the reader's key
                </span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="text-muted-foreground/60 hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 transition-colors"
                    title="Copy ciphertext"
                >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
            </div>
            <pre className="text-xs font-mono px-3 pb-3 pt-1.5 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                {highlightJson(
                    JSON.stringify(
                        {
                            encrypted: true,
                            reader: row.reader,
                            offset: row.offset,
                            ciphertextBytes: row.ciphertextBytes,
                            ciphertextHex: row.ciphertext,
                        },
                        null,
                        2,
                    ),
                )}
            </pre>
        </div>
    );
}

/** What the viewing key opened. Exists only in this tab's session vault. */
function DecryptedPanel({ message }: { message: DecryptedMessage }) {
    return (
        <div className="m-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
            <p className="px-3 pt-2.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                Decrypted in this tab · visible only to you
            </p>
            <pre className="text-xs font-mono px-3 pb-3 pt-1.5 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                {highlightJson(JSON.stringify(message.envelope ?? message.text, null, 2))}
            </pre>
        </div>
    );
}

interface DisclosureLogProps {
    address: Address | undefined;
    enabled?: boolean;
}

/**
 * Access history for an encrypted channel: who was granted read access, who read which
 * message, which reads were refused, and how long after publication. Payloads stay sealed
 * except disclosures to the connected wallet, which this tab's viewing key opens.
 */
export function DisclosureLog({ address, enabled = true }: DisclosureLogProps) {
    const { entries, startBlock, lastScannedBlock, caughtUp, isFetching, error, refresh } =
        useDisclosureLog(address, { enabled });
    const failedAttempts = useFailedReadAttempts(address, enabled);
    const { address: viewer } = useAccount();
    const { status: keyStatus } = useViewKey();
    const { decrypted, attempts: localAttempts } = useSessionRecords(viewer);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const rows = useMemo<LogRow[]>(() => {
        const channel = address?.toLowerCase();
        const byTx = new Map<string, LogRow>();
        for (const attempt of failedAttempts.data ?? []) {
            // Keep attempts inside the same window as the event scan, so the log reads as
            // one consistent tail.
            if (startBlock !== undefined && attempt.blockNumber < startBlock) continue;
            byTx.set(attempt.txHash, {
                id: `${attempt.txHash}:failed`,
                kind: attempt.stage === "request" ? "rejected" : "callback-failed",
                blockNumber: attempt.blockNumber,
                timestamp: attempt.timestamp,
                txHash: attempt.txHash,
                reader: attempt.reader,
                offset: attempt.offset,
                reason: attempt.reason,
            });
        }
        // This tab's own failures show at once; the explorer copy replaces nothing it knows
        // better, since both describe the same transaction.
        for (const attempt of localAttempts) {
            if (attempt.channel.toLowerCase() !== channel || byTx.has(attempt.txHash)) continue;
            byTx.set(attempt.txHash, {
                id: `${attempt.txHash}:failed`,
                kind: attempt.stage === "request" ? "rejected" : "callback-failed",
                blockNumber: BigInt(attempt.blockNumber),
                timestamp: attempt.timestamp,
                txHash: attempt.txHash,
                reader: attempt.reader,
                offset: attempt.offset,
                reason: attempt.reason,
            });
        }
        return [...entries, ...byTx.values()].sort((a, b) => {
            if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
            return a.id < b.id ? 1 : -1;
        });
    }, [entries, failedAttempts.data, localAttempts, startBlock, address]);

    // Disclosures addressed to the connected wallet open locally, with no transaction. Each
    // is tried once: one sealed to an older key simply stays ciphertext.
    const tried = useRef(new Set<string>());
    useEffect(() => {
        if (!address || !viewer || keyStatus !== "ready") return;
        for (const entry of entries) {
            if (entry.kind !== "disclosure" || !entry.ciphertext || entry.offset === undefined)
                continue;
            if (entry.reader.toLowerCase() !== viewer.toLowerCase()) continue;
            if (decrypted[decryptedKey(address, entry.offset)] || tried.current.has(entry.id))
                continue;
            tried.current.add(entry.id);
            void openDisclosure({
                reader: viewer,
                channel: address,
                offset: entry.offset,
                payload: entry.ciphertext,
                txHash: entry.txHash,
            }).catch(() => undefined);
        }
    }, [entries, address, viewer, keyStatus, decrypted]);

    const toggleExpand = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const disclosed = entries.filter((entry) => entry.kind === "disclosure").length;
    const readers = new Set(
        entries.filter((entry) => entry.kind === "disclosure").map((entry) => entry.reader),
    ).size;
    const rejected = rows.length - entries.length;
    const checking = isFetching || failedAttempts.isFetching;

    const decryptedFor = (row: LogRow) =>
        address &&
        viewer &&
        row.kind === "disclosure" &&
        row.offset !== undefined &&
        row.reader?.toLowerCase() === viewer.toLowerCase()
            ? decrypted[decryptedKey(address, row.offset)]
            : undefined;

    return (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">Access log</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {startBlock === undefined ? (
                            "Starting up…"
                        ) : (
                            <>
                                Watching from block{" "}
                                <span className="tabular-nums">{startBlock.toString()}</span>
                                {lastScannedBlock !== undefined && (
                                    <>
                                        {" → "}
                                        <span className="tabular-nums">
                                            {lastScannedBlock.toString()}
                                        </span>
                                    </>
                                )}
                                {!caughtUp && " · catching up"}
                                {" · checks every 90s"}
                            </>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {(disclosed > 0 || rejected > 0) && (
                        <span className="text-xs text-muted-foreground">
                            <span className="text-foreground font-medium tabular-nums">
                                {disclosed}
                            </span>{" "}
                            {disclosed === 1 ? "read" : "reads"} by{" "}
                            <span className="text-foreground font-medium tabular-nums">
                                {readers}
                            </span>{" "}
                            {readers === 1 ? "reader" : "readers"}
                            {rejected > 0 && (
                                <>
                                    {" · "}
                                    <span className="text-destructive font-medium tabular-nums">
                                        {rejected}
                                    </span>{" "}
                                    failed
                                </>
                            )}
                        </span>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            refresh();
                            void failedAttempts.refetch();
                        }}
                        disabled={checking}
                        aria-label="Check for new activity now"
                    >
                        {checking ? (
                            <Loader2 className="animate-spin" />
                        ) : (
                            <RotateCw aria-hidden="true" />
                        )}
                        {checking ? "Checking" : "Check now"}
                    </Button>
                </div>
            </div>

            {error ? (
                <div className="px-4 py-8 text-center">
                    <p className="text-sm text-destructive">Could not read the access log.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {error.message} — try again, or check the RPC endpoint.
                    </p>
                </div>
            ) : rows.length === 0 ? (
                <div className="px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                        No reads, refusals or reader changes in the watched window.
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1 max-w-md mx-auto">
                        This log looks back one RPC window from when the page loaded and follows the
                        chain from there. It does not search earlier history.
                    </p>
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="px-4">When</TableHead>
                            <TableHead className="px-3">Event</TableHead>
                            <TableHead className="px-3">Reader</TableHead>
                            <TableHead className="px-3">Message</TableHead>
                            <TableHead className="px-3">Ciphertext</TableHead>
                            <TableHead className="px-3">After publish</TableHead>
                            <TableHead className="w-10 px-3" />
                            <TableHead className="w-10 px-3" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => {
                            const ago = timeAgo(row.timestamp);
                            const txUrl = getExplorerTxUrl(row.txHash);
                            const message = decryptedFor(row);
                            // Only disclosures carry a payload; every other row has nothing
                            // to open, so it stays inert.
                            const canExpand = !!row.ciphertext;
                            const isExpanded = canExpand && expanded.has(row.id);
                            return (
                                <Fragment key={row.id}>
                                    <TableRow
                                        className={canExpand ? "cursor-pointer" : undefined}
                                        onClick={canExpand ? () => toggleExpand(row.id) : undefined}
                                    >
                                        <TableCell className="px-4">
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${timeAgoColors[ago.color]}`}
                                            >
                                                {ago.label}
                                            </span>
                                            <span className="block text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
                                                block {row.blockNumber.toString()}
                                            </span>
                                        </TableCell>
                                        <TableCell className="px-3">
                                            <EventCell row={row} decrypted={!!message} />
                                        </TableCell>
                                        <TableCell className="px-3">
                                            {row.reader ? (
                                                <AddressBadge address={row.reader} />
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {row.offset === undefined ? "—" : `#${row.offset}`}
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {row.ciphertextBytes === undefined
                                                ? "—"
                                                : formatBytes(row.ciphertextBytes)}
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {row.latencySeconds === undefined ? (
                                                <span title="The publication of this message is older than this log">
                                                    —
                                                </span>
                                            ) : (
                                                `+${formatDuration(row.latencySeconds)}`
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3">
                                            {txUrl && (
                                                <a
                                                    href={txUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground/60 hover:text-foreground transition-colors"
                                                    aria-label="View transaction in explorer"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3">
                                            {canExpand && (
                                                <ChevronRight
                                                    aria-label={
                                                        isExpanded
                                                            ? "Hide ciphertext"
                                                            : "Show ciphertext"
                                                    }
                                                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                                />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                    {isExpanded && (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={8} className="p-0">
                                                {message && <DecryptedPanel message={message} />}
                                                <CiphertextPanel row={row} />
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            )}

            <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                Click a disclosure to see the ciphertext that was emitted. Payloads stay encrypted
                to each reader's key; only disclosures to your connected wallet open here, and only
                in this tab. Readers, offsets, ciphertext and failed attempts are all public
                on-chain — this view surfaces them, it does not expose them.
            </p>
        </div>
    );
}
