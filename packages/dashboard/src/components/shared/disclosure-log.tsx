import {
    Check,
    ChevronRight,
    Copy,
    ExternalLink,
    Eye,
    Loader2,
    RotateCw,
    UserMinus,
    UserPlus,
} from "lucide-react";
import { Fragment, useState } from "react";
import type { Address } from "viem";
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
import { getExplorerTxUrl } from "@/lib/explorer";
import { highlightJson } from "@/lib/json-highlight";
import { timeAgo, timeAgoColors } from "@/lib/time-ago";

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

function EventCell({ entry }: { entry: DisclosureEntry }) {
    if (entry.kind === "disclosure") {
        return (
            <Badge variant="secondary" className="gap-1.5">
                <Eye className="text-sky-500 dark:text-sky-400" />
                Disclosed
            </Badge>
        );
    }
    if (entry.kind === "reader-added") {
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
function CiphertextPanel({ entry }: { entry: DisclosureEntry }) {
    const [copied, setCopied] = useState(false);

    function handleCopy() {
        if (!entry.ciphertext) return;
        navigator.clipboard.writeText(entry.ciphertext);
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
                            reader: entry.reader,
                            offset: entry.offset,
                            ciphertextBytes: entry.ciphertextBytes,
                            ciphertextHex: entry.ciphertext,
                        },
                        null,
                        2,
                    ),
                )}
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
 * message, and how long after publication. Payloads stay sealed — every column here is
 * metadata that is public on-chain regardless of this view.
 */
export function DisclosureLog({ address, enabled = true }: DisclosureLogProps) {
    const { entries, startBlock, lastScannedBlock, caughtUp, isFetching, error, refresh } =
        useDisclosureLog(address, { enabled });
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
                    {disclosed > 0 && (
                        <span className="text-xs text-muted-foreground">
                            <span className="text-foreground font-medium tabular-nums">
                                {disclosed}
                            </span>{" "}
                            {disclosed === 1 ? "read" : "reads"} by{" "}
                            <span className="text-foreground font-medium tabular-nums">
                                {readers}
                            </span>{" "}
                            {readers === 1 ? "reader" : "readers"}
                        </span>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={refresh}
                        disabled={isFetching}
                        aria-label="Check for new activity now"
                    >
                        {isFetching ? (
                            <Loader2 className="animate-spin" />
                        ) : (
                            <RotateCw aria-hidden="true" />
                        )}
                        {isFetching ? "Checking" : "Check now"}
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
            ) : entries.length === 0 ? (
                <div className="px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                        No reads or reader changes since this page was opened.
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1 max-w-md mx-auto">
                        This log starts when the page loads and follows the chain from there. It
                        does not search back through earlier history.
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
                        {entries.map((entry) => {
                            const ago = timeAgo(entry.timestamp);
                            const txUrl = getExplorerTxUrl(entry.txHash);
                            // Only disclosures carry a payload; grant/revoke rows have
                            // nothing to open, so they stay inert.
                            const canExpand = !!entry.ciphertext;
                            const isExpanded = canExpand && expanded.has(entry.id);
                            return (
                                <Fragment key={entry.id}>
                                    <TableRow
                                        className={canExpand ? "cursor-pointer" : undefined}
                                        onClick={
                                            canExpand ? () => toggleExpand(entry.id) : undefined
                                        }
                                    >
                                        <TableCell className="px-4">
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${timeAgoColors[ago.color]}`}
                                            >
                                                {ago.label}
                                            </span>
                                            <span className="block text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
                                                block {entry.blockNumber.toString()}
                                            </span>
                                        </TableCell>
                                        <TableCell className="px-3">
                                            <EventCell entry={entry} />
                                        </TableCell>
                                        <TableCell className="px-3">
                                            <AddressBadge address={entry.reader} />
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {entry.offset === undefined ? "—" : `#${entry.offset}`}
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {entry.ciphertextBytes === undefined
                                                ? "—"
                                                : formatBytes(entry.ciphertextBytes)}
                                        </TableCell>
                                        <TableCell className="px-3 tabular-nums text-muted-foreground">
                                            {entry.latencySeconds === undefined ? (
                                                <span title="The publication of this message is older than this log">
                                                    —
                                                </span>
                                            ) : (
                                                `+${formatDuration(entry.latencySeconds)}`
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
                                                <CiphertextPanel entry={entry} />
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
                to each reader's key and cannot be opened here. Reader addresses, message offsets
                and the ciphertext itself are public on-chain — this view surfaces them, it does not
                expose them.
            </p>
        </div>
    );
}
