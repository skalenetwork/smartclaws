import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { type Address, type Hex, parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { chain } from "@/config/wagmi";

const watchedEvents = [
    parseAbiItem("event MessagePublished(address indexed channel, uint256 indexed offset)"),
    parseAbiItem(
        "event MessageDisclosed(address indexed channel, address indexed reader, uint256 indexed offset, bytes encryptedPayload)",
    ),
    parseAbiItem("event ReaderAdded(address indexed reader)"),
    parseAbiItem("event ReaderRemoved(address indexed reader)"),
] as const;

export const ACTIVITY_WINDOW_SECONDS = 24 * 60 * 60;

// The default SKALE RPC rejects eth_getLogs spans over 2,000 blocks. One request covers
// every channel at once (the address filter takes a list), so cost scales with the window,
// not with the number of channels.
const RPC_MAX_BLOCK_SPAN = 2_000n;

// Blocks here average ~10s but are produced on demand, so the backfill walks back until a
// window starts before the 24h mark. The cap bounds a first load on a very busy chain.
const MAX_BACKFILL_CHUNKS = 15;
const MAX_CHUNKS_PER_TICK = 4;

// Fetching a timestamp for every event's block would cost one request each. Instead,
// timestamps are read at fixed block intervals and interpolated between them — plenty for
// hourly buckets — and read exactly for the newest events, which the feed shows by the minute.
const ANCHOR_SPACING = 500n;
const EXACT_TIMES_FOR_NEWEST = 25;
const LOOKUP_CONCURRENCY = 8;

const POLL_INTERVAL_MS = 30_000;

export type ActivityKind = "published" | "disclosed" | "reader-added" | "reader-removed";

export interface ActivityEvent {
    /** `${txHash}:${logIndex}` */
    id: string;
    kind: ActivityKind;
    channel: Address;
    blockNumber: bigint;
    txHash: Hex;
    /** Exact for recent events, interpolated from nearby blocks for older ones. */
    timestamp: number;
    offset?: number;
    reader?: Address;
}

type RawEvent = Omit<ActivityEvent, "timestamp">;

interface ScanState {
    key: string;
    nextFrom?: bigint;
    events: RawEvent[];
    seen: Set<string>;
    blockTimes: Map<bigint, number>;
}

const emptyState = (key: string): ScanState => ({
    key,
    events: [],
    seen: new Set(),
    blockTimes: new Map(),
});

const EVENT_KINDS: Record<string, ActivityKind> = {
    MessagePublished: "published",
    MessageDisclosed: "disclosed",
    ReaderAdded: "reader-added",
    ReaderRemoved: "reader-removed",
};

const newestFirst = (a: { blockNumber: bigint; id: string }, b: typeof a) =>
    a.blockNumber === b.blockNumber
        ? a.id < b.id
            ? 1
            : -1
        : a.blockNumber > b.blockNumber
          ? -1
          : 1;

/**
 * Everything the registry's channels did in the last 24 hours: publications, disclosures,
 * and reader grants and revocations. Backfills the window once, then follows new blocks.
 */
export function useNetworkActivity(channels: Address[]) {
    const client = usePublicClient({ chainId: chain.id });
    const key = useMemo(
        () =>
            channels
                .map((channel) => channel.toLowerCase())
                .sort()
                .join(","),
        [channels],
    );
    const stateRef = useRef<ScanState>(emptyState(key));
    // A different channel set is a different scan.
    if (stateRef.current.key !== key) stateRef.current = emptyState(key);

    return useQuery<ActivityEvent[], Error>({
        queryKey: ["network-activity", chain.id, key],
        queryFn: async () => {
            if (!client || channels.length === 0) throw new Error("Activity query is not ready");
            const state = stateRef.current;
            const latest = await client.getBlockNumber();
            const since = Math.floor(Date.now() / 1000) - ACTIVITY_WINDOW_SECONDS;

            const timeOf = async (blockNumber: bigint) => {
                const known = state.blockTimes.get(blockNumber);
                if (known !== undefined) return known;
                const block = await client.getBlock({ blockNumber });
                const time = Number(block.timestamp);
                state.blockTimes.set(blockNumber, time);
                return time;
            };

            const scan = async (fromBlock: bigint, toBlock: bigint) => {
                const logs = await client.getLogs({
                    address: channels,
                    events: watchedEvents,
                    fromBlock,
                    toBlock,
                });
                for (const log of logs) {
                    if (log.transactionHash === null || log.logIndex === null) continue;
                    const id = `${log.transactionHash}:${log.logIndex}`;
                    const kind = EVENT_KINDS[log.eventName];
                    if (!kind || state.seen.has(id)) continue;
                    state.seen.add(id);
                    const args = log.args as { reader?: Address; offset?: bigint };
                    state.events.push({
                        id,
                        kind,
                        channel: log.address,
                        blockNumber: log.blockNumber ?? 0n,
                        txHash: log.transactionHash,
                        offset: args.offset === undefined ? undefined : Number(args.offset),
                        reader: args.reader,
                    });
                }
            };

            if (state.nextFrom === undefined) {
                let end = latest;
                for (let chunk = 0; chunk < MAX_BACKFILL_CHUNKS; chunk += 1) {
                    const from = end >= RPC_MAX_BLOCK_SPAN ? end - RPC_MAX_BLOCK_SPAN + 1n : 0n;
                    await scan(from, end);
                    if (from === 0n || (await timeOf(from)) < since) break;
                    end = from - 1n;
                }
                state.nextFrom = latest + 1n;
            } else {
                let cursor: bigint = state.nextFrom;
                for (let chunk = 0; chunk < MAX_CHUNKS_PER_TICK && cursor <= latest; chunk += 1) {
                    const end: bigint = cursor + RPC_MAX_BLOCK_SPAN - 1n;
                    const to: bigint = end > latest ? latest : end;
                    await scan(cursor, to);
                    cursor = to + 1n;
                    state.nextFrom = cursor;
                }
            }

            // Resolve the anchors each event sits between, plus exact times for the newest.
            const anchorBelow = (blockNumber: bigint) =>
                blockNumber - (blockNumber % ANCHOR_SPACING);
            const anchorAbove = (blockNumber: bigint) => {
                const above = anchorBelow(blockNumber) + ANCHOR_SPACING;
                return above > latest ? latest : above;
            };
            state.events.sort(newestFirst);
            const exact = new Set(
                state.events.slice(0, EXACT_TIMES_FOR_NEWEST).map((event) => event.blockNumber),
            );
            const needed = new Set<bigint>(exact);
            for (const event of state.events) {
                needed.add(anchorBelow(event.blockNumber));
                needed.add(anchorAbove(event.blockNumber));
            }
            const missing = [...needed].filter((blockNumber) => !state.blockTimes.has(blockNumber));
            for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
                await Promise.all(missing.slice(i, i + LOOKUP_CONCURRENCY).map(timeOf));
            }

            const timestampOf = (blockNumber: bigint): number => {
                const known = state.blockTimes.get(blockNumber);
                if (known !== undefined) return known;
                const below = anchorBelow(blockNumber);
                const above = anchorAbove(blockNumber);
                const low = state.blockTimes.get(below) ?? 0;
                const high = state.blockTimes.get(above) ?? low;
                if (above === below) return low;
                return low + ((high - low) * Number(blockNumber - below)) / Number(above - below);
            };

            const events = state.events
                .map((event) => ({
                    ...event,
                    timestamp: Math.round(timestampOf(event.blockNumber)),
                }))
                .filter((event) => event.timestamp >= since);

            // Forget what fell out of the window, so a tab left open does not grow forever.
            if (events.length !== state.events.length) {
                const kept = new Set(events.map((event) => event.id));
                state.events = state.events.filter((event) => kept.has(event.id));
                state.seen = kept;
                const oldest = state.events.at(-1)?.blockNumber ?? latest;
                for (const blockNumber of state.blockTimes.keys()) {
                    if (blockNumber < oldest - ANCHOR_SPACING) state.blockTimes.delete(blockNumber);
                }
            }
            return events;
        },
        enabled: !!client && channels.length > 0,
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        placeholderData: (previous) => previous,
        retry: 1,
    });
}
