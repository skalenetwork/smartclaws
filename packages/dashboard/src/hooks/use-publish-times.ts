import { useQuery } from "@tanstack/react-query";
import { type Address, parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { chain } from "@/config/wagmi";

const messagePublished = parseAbiItem(
    "event MessagePublished(address indexed channel, uint256 indexed offset)",
);

// The default SKALE RPC rejects eth_getLogs spans over 2,000 blocks. Blocks average ~10s, so
// 25 windows reach back roughly six days; anything older shows no time rather than costing
// an unbounded scan.
const RPC_MAX_BLOCK_SPAN = 2_000n;
const MAX_WINDOWS = 25;
const LOOKUP_CONCURRENCY = 8;

// A published offset never moves to another block, so what is learned here is kept for the
// session. `unfound` remembers offsets a full scan missed, so a new message arriving (which
// changes the query key) never re-runs that scan.
const blockOf = new Map<string, bigint>();
const timeOfBlock = new Map<bigint, number>();
const unfound = new Set<string>();

const entryKey = (channel: Address, offset: bigint) =>
    `${chain.id}:${channel.toLowerCase()}:${offset}`;

/**
 * When each message was added to the chain: the timestamp of the block holding its
 * `MessagePublished` event.
 *
 * An encrypted message's own timestamp sits inside the ciphertext, but the block it landed
 * in is public. For encrypted channels the event is emitted by the BITE callback, so this is
 * when the message was actually stored, one block after the request that submitted it.
 */
export function usePublishTimes(channel: Address | undefined, offsets: bigint[], enabled = true) {
    const client = usePublicClient({ chainId: chain.id });
    const offsetsKey = offsets.join(",");

    const query = useQuery<Record<string, number | undefined>, Error>({
        queryKey: ["publish-times", chain.id, channel?.toLowerCase(), offsetsKey],
        queryFn: async () => {
            if (!client || !channel) throw new Error("Publish time query is not ready");
            const missing = offsets.filter((offset) => {
                const key = entryKey(channel, offset);
                return !blockOf.has(key) && !unfound.has(key);
            });

            if (missing.length > 0) {
                const wanted = new Set(missing);
                const newest = missing.reduce((a, b) => (a > b ? a : b));

                // Offsets are published in order, so the block of any later offset already
                // located is as far forward as the missing ones can be.
                let end = await client.getBlockNumber();
                for (const [key, block] of blockOf) {
                    const [, keyChannel, keyOffset] = key.split(":");
                    if (keyChannel !== channel.toLowerCase()) continue;
                    if (BigInt(keyOffset) > newest && block < end) end = block;
                }

                for (let window = 0; window < MAX_WINDOWS && wanted.size > 0; window += 1) {
                    const from = end >= RPC_MAX_BLOCK_SPAN ? end - RPC_MAX_BLOCK_SPAN + 1n : 0n;
                    const logs = await client.getLogs({
                        address: channel,
                        event: messagePublished,
                        args: { offset: [...wanted] },
                        fromBlock: from,
                        toBlock: end,
                    });
                    for (const log of logs) {
                        const offset = log.args.offset;
                        if (offset === undefined || log.blockNumber === null) continue;
                        blockOf.set(entryKey(channel, offset), log.blockNumber);
                        wanted.delete(offset);
                    }
                    if (from === 0n) break;
                    end = from - 1n;
                }
                for (const offset of wanted) unfound.add(entryKey(channel, offset));
            }

            const blocks = [
                ...new Set(
                    offsets
                        .map((offset) => blockOf.get(entryKey(channel, offset)))
                        .filter((block): block is bigint => block !== undefined),
                ),
            ].filter((block) => !timeOfBlock.has(block));
            for (let i = 0; i < blocks.length; i += LOOKUP_CONCURRENCY) {
                await Promise.all(
                    blocks.slice(i, i + LOOKUP_CONCURRENCY).map(async (blockNumber) => {
                        const block = await client.getBlock({ blockNumber });
                        timeOfBlock.set(blockNumber, Number(block.timestamp));
                    }),
                );
            }

            return Object.fromEntries(
                offsets.map((offset) => {
                    const block = blockOf.get(entryKey(channel, offset));
                    return [
                        offset.toString(),
                        block === undefined ? undefined : timeOfBlock.get(block),
                    ];
                }),
            );
        },
        enabled: enabled && !!client && !!channel && offsets.length > 0,
        staleTime: Number.POSITIVE_INFINITY,
        placeholderData: (previous) => previous,
        retry: 1,
    });

    return {
        /** Seconds, or undefined while loading or when the message is older than the scan. */
        timeOf: (offset: bigint) => query.data?.[offset.toString()],
        isLoading: query.isFetching,
    };
}
