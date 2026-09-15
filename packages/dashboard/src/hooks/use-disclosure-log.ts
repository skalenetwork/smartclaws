import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { type Address, type Hex, parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { chain } from "@/config/wagmi";

const messagePublishedEvent = parseAbiItem(
    "event MessagePublished(address indexed channel, uint256 indexed offset)",
);
const messageDisclosedEvent = parseAbiItem(
    "event MessageDisclosed(address indexed channel, address indexed reader, uint256 indexed offset, bytes encryptedPayload)",
);
const readerAddedEvent = parseAbiItem("event ReaderAdded(address indexed reader)");
const readerRemovedEvent = parseAbiItem("event ReaderRemoved(address indexed reader)");

// One eth_getLogs covers all four: topic0 accepts an array, so adding event types costs
// no extra requests. MessagesPruned is deliberately not watched — eviction is a storage
// concern, and the access record outlives the payload it refers to.
const watchedEvents = [
    messagePublishedEvent,
    messageDisclosedEvent,
    readerAddedEvent,
    readerRemovedEvent,
] as const;

// The default SKALE RPC rejects eth_getLogs requests spanning more than 2,000 blocks
// (same ceiling use-channel-activity works around).
const RPC_MAX_BLOCK_SPAN = 2_000n;

// This log is a tail, not an archive: the first scan seeds one RPC window of context and
// every later scan only covers blocks produced since. History older than the seed is never
// fetched — set to 0n for a cold start that shows nothing until the next event lands.
const INITIAL_LOOKBACK_BLOCKS = 2_000n;

// A backgrounded tab can fall behind. Bound the catch-up work per tick so a stale cursor
// never turns into a burst of requests; whatever is left is picked up on the following tick.
// At four windows a tick this outruns block production by orders of magnitude, so the cursor
// always converges and no range is ever skipped.
const MAX_CHUNKS_PER_TICK = 4;

// Timestamps cost one getBlock each, deduped per block and cached for the session. Steady
// state needs a handful; the cap only bites on the seed scan, and rows past it are retried
// on the next tick. Issued in small concurrent batches so the burst stays bounded.
const MAX_BLOCK_LOOKUPS_PER_TICK = 60;
const BLOCK_LOOKUP_CONCURRENCY = 8;

const POLL_INTERVAL_MS = 90_000;

// Rows are kept newest-first and trimmed so a long-lived tab cannot grow without bound.
const MAX_ENTRIES = 500;

export type DisclosureEntryKind = "disclosure" | "reader-added" | "reader-removed";

export interface DisclosureEntry {
    kind: DisclosureEntryKind;
    /** `${txHash}:${logIndex}` — stable across refetches, used to dedupe overlapping scans. */
    id: string;
    blockNumber: bigint;
    timestamp?: number;
    txHash: Hex;
    reader: Address;
    /** Message offset. Absent on reader grant/revoke rows. */
    offset?: number;
    /** Size of the re-encrypted payload. Visible without any key — see the note in the UI. */
    ciphertextBytes?: number;
    /**
     * The re-encrypted payload itself, as emitted. Kept so a row can be expanded to show
     * exactly what went on-chain; it is sealed to the reader's key, so holding it here
     * discloses nothing the event log does not already publish. Bounded by MAX_ENTRIES.
     */
    ciphertext?: Hex;
    /**
     * Seconds between a message being published and this disclosure of it. Only known when
     * the publication also fell inside this tail, so it is absent for older messages.
     */
    latencySeconds?: number;
}

interface ScanState {
    address?: Address;
    /** First block this session ever looked at; surfaced so the UI can say where the tail begins. */
    startBlock?: bigint;
    /** Next block to request. `undefined` until the first scan pins it to the chain head. */
    nextFrom?: bigint;
    entries: DisclosureEntry[];
    seen: Set<string>;
    blockTimes: Map<string, number>;
    /** offset → block it was published in, so disclosures can report how stale the read was. */
    publishedIn: Map<number, bigint>;
    caughtUp: boolean;
    lastScannedBlock?: bigint;
}

function emptyState(): ScanState {
    return {
        entries: [],
        seen: new Set(),
        blockTimes: new Map(),
        publishedIn: new Map(),
        caughtUp: false,
    };
}

export interface DisclosureLogResult {
    entries: DisclosureEntry[];
    /** Block the tail starts at — everything before this is deliberately not fetched. */
    startBlock?: bigint;
    lastScannedBlock?: bigint;
    /** False while a backgrounded tab is still working through a gap. */
    caughtUp: boolean;
    isFetching: boolean;
    isInitializing: boolean;
    error: Error | null;
    /** Scans immediately and restarts the poll timer. */
    refresh: () => void;
}

/**
 * Tails an encrypted channel's public record: messages published, messages disclosed to a
 * reader, and the grants that authorise those reads — one sequence, one request per window.
 *
 * Deliberately forward-only. This metadata is public and permanent, so a full backfill is
 * possible but expensive against a 2,000-block-per-request RPC; the hook trades history for
 * a light, predictable request rate.
 *
 * SKALE finalises without reorgs, so scanned ranges are never revisited.
 */
export function useDisclosureLog(
    address: Address | undefined,
    options: { enabled?: boolean } = {},
): DisclosureLogResult {
    const { enabled = true } = options;
    const client = usePublicClient({ chainId: chain.id });
    const stateRef = useRef<ScanState>(emptyState());

    // A different channel is a different tail. Reset before any scan reads the ref.
    if (address && stateRef.current.address !== address) {
        stateRef.current = { ...emptyState(), address };
    }

    const query = useQuery<DisclosureEntry[], Error>({
        queryKey: ["disclosure-log", chain.id, address?.toLowerCase()],
        queryFn: async () => {
            if (!client || !address) throw new Error("Access log query is not ready");
            const state = stateRef.current;
            const latestBlock = await client.getBlockNumber();

            if (state.nextFrom === undefined) {
                state.nextFrom =
                    latestBlock >= INITIAL_LOOKBACK_BLOCKS
                        ? latestBlock - INITIAL_LOOKBACK_BLOCKS
                        : 0n;
                state.startBlock = state.nextFrom;
            }

            const pending: DisclosureEntry[] = [];
            let cursor: bigint = state.nextFrom;
            let chunks = 0;
            while (cursor <= latestBlock && chunks < MAX_CHUNKS_PER_TICK) {
                const chunkEnd: bigint = cursor + RPC_MAX_BLOCK_SPAN - 1n;
                const toBlock: bigint = chunkEnd > latestBlock ? latestBlock : chunkEnd;

                const logs = await client.getLogs({
                    address,
                    events: watchedEvents,
                    fromBlock: cursor,
                    toBlock,
                });

                for (const log of logs) {
                    if (log.transactionHash === null || log.logIndex === null) continue;
                    const id = `${log.transactionHash}:${log.logIndex}`;
                    if (state.seen.has(id)) continue;

                    const args = log.args as {
                        reader?: Address;
                        offset?: bigint;
                        encryptedPayload?: Hex;
                    };
                    const blockNumber = log.blockNumber ?? 0n;
                    const base = { id, blockNumber, txHash: log.transactionHash };
                    const offset = args.offset === undefined ? undefined : Number(args.offset);

                    if (log.eventName === "MessagePublished") {
                        // Watched only to date each message, never shown as a row: this log is
                        // about access, and the channel's own message table already lists what
                        // was published. Emitted from the BITE callback rather than the
                        // submitting transaction, so it marks when the message actually landed.
                        if (offset === undefined) continue;
                        state.publishedIn.set(offset, blockNumber);
                        state.seen.add(id);
                        continue;
                    }
                    if (log.eventName === "MessageDisclosed") {
                        if (!args.reader) continue;
                        pending.push({
                            ...base,
                            kind: "disclosure",
                            reader: args.reader,
                            offset,
                            // Hex string minus the 0x prefix, two characters per byte.
                            ciphertextBytes: args.encryptedPayload
                                ? (args.encryptedPayload.length - 2) / 2
                                : 0,
                            ciphertext: args.encryptedPayload,
                        });
                    } else if (log.eventName === "ReaderAdded") {
                        if (!args.reader) continue;
                        pending.push({ ...base, kind: "reader-added", reader: args.reader });
                    } else if (log.eventName === "ReaderRemoved") {
                        if (!args.reader) continue;
                        pending.push({ ...base, kind: "reader-removed", reader: args.reader });
                    } else {
                        continue;
                    }
                    state.seen.add(id);
                }

                state.lastScannedBlock = toBlock;
                cursor = toBlock + 1n;
                state.nextFrom = cursor;
                chunks += 1;
            }
            state.caughtUp = cursor > latestBlock;

            if (pending.length > 0) {
                state.entries = [...pending, ...state.entries]
                    .sort((a, b) => {
                        if (a.blockNumber !== b.blockNumber)
                            return a.blockNumber > b.blockNumber ? -1 : 1;
                        return a.id < b.id ? 1 : -1;
                    })
                    .slice(0, MAX_ENTRIES);
            }

            // Resolve block times once per block, reusing the cache across ticks. Walk the
            // merged rows rather than this tick's logs: entries are newest-first, so the cap
            // is spent on what the reader can actually see, and anything left over is retried
            // on the next tick instead of being stranded without a timestamp forever.
            // Disclosure rows also need their message's publication block to show latency.
            const needed: bigint[] = [];
            const want = (blockNumber: bigint) => {
                if (needed.length >= MAX_BLOCK_LOOKUPS_PER_TICK) return;
                const key = blockNumber.toString();
                if (!state.blockTimes.has(key) && !needed.includes(blockNumber)) {
                    needed.push(blockNumber);
                }
            };
            for (const entry of state.entries) {
                if (needed.length >= MAX_BLOCK_LOOKUPS_PER_TICK) break;
                want(entry.blockNumber);
                if (entry.kind === "disclosure" && entry.offset !== undefined) {
                    const publishedIn = state.publishedIn.get(entry.offset);
                    if (publishedIn !== undefined) want(publishedIn);
                }
            }
            for (let i = 0; i < needed.length; i += BLOCK_LOOKUP_CONCURRENCY) {
                const batch = needed.slice(i, i + BLOCK_LOOKUP_CONCURRENCY);
                const blocks = await Promise.all(
                    batch.map((blockNumber) => client.getBlock({ blockNumber })),
                );
                batch.forEach((blockNumber, index) => {
                    state.blockTimes.set(blockNumber.toString(), Number(blocks[index].timestamp));
                });
            }

            // Re-stamp every row: a timestamp may resolve on a later tick than the entry
            // itself, and a publication seen after a disclosure fills in that row's latency.
            return state.entries.map((entry) => {
                const timestamp = state.blockTimes.get(entry.blockNumber.toString());
                if (entry.kind !== "disclosure" || entry.offset === undefined) {
                    return { ...entry, timestamp };
                }
                const publishedIn = state.publishedIn.get(entry.offset);
                const publishedAt =
                    publishedIn === undefined
                        ? undefined
                        : state.blockTimes.get(publishedIn.toString());
                return {
                    ...entry,
                    timestamp,
                    latencySeconds:
                        timestamp !== undefined && publishedAt !== undefined
                            ? Math.max(0, timestamp - publishedAt)
                            : undefined,
                };
            });
        },
        enabled: enabled && !!client && !!address,
        // react-query schedules the next run from the end of the last one, so an explicit
        // refetch() restarts the timer rather than firing alongside it.
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        // The accumulator lives in the ref; keep the last render's rows during a refetch.
        placeholderData: (previous) => previous,
        retry: 1,
    });

    const refresh = useCallback(() => {
        void query.refetch();
    }, [query.refetch]);

    return {
        entries: query.data ?? [],
        startBlock: stateRef.current.startBlock,
        lastScannedBlock: stateRef.current.lastScannedBlock,
        caughtUp: stateRef.current.caughtUp,
        isFetching: query.isFetching,
        isInitializing: query.isLoading,
        error: query.error,
        refresh,
    };
}
