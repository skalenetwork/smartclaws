import { useQueries } from "@tanstack/react-query";
import { type Address, parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { chain } from "@/config/wagmi";

const messagePublishedEvent = parseAbiItem(
    "event MessagePublished(address indexed channel, uint256 indexed offset)",
);

// The default SKALE RPC rejects eth_getLogs requests spanning more than 2,000 blocks.
// Activity is a freshness signal, so inspect only the latest accepted window instead of
// replaying history. Older publications intentionally produce an unknown timestamp.
const ACTIVITY_LOOKBACK_BLOCKS = 2_000n;

export interface ChannelActivityRef {
    address?: Address;
    latestOffset?: bigint;
    enabled?: boolean;
}

export function useChannelActivityTimes(channels: ChannelActivityRef[]) {
    const client = usePublicClient({ chainId: chain.id });
    const queries = useQueries({
        queries: channels.map(({ address, latestOffset, enabled = true }) => ({
            queryKey: [
                "message-published-time",
                chain.id,
                address?.toLowerCase(),
                latestOffset?.toString(),
            ],
            queryFn: async () => {
                if (!client || !address || latestOffset === undefined) {
                    throw new Error("Channel activity query is not ready");
                }
                const latestBlock = await client.getBlockNumber();
                const fromBlock =
                    latestBlock >= ACTIVITY_LOOKBACK_BLOCKS
                        ? latestBlock - ACTIVITY_LOOKBACK_BLOCKS + 1n
                        : 0n;
                const logs = await client.getLogs({
                    address,
                    event: messagePublishedEvent,
                    args: { channel: address, offset: latestOffset },
                    fromBlock,
                    toBlock: latestBlock,
                });
                const blockNumber = logs.at(-1)?.blockNumber;
                if (blockNumber === undefined) return undefined;
                const block = await client.getBlock({ blockNumber });
                return Number(block.timestamp);
            },
            enabled: !!client && !!address && latestOffset !== undefined && enabled,
            // Channel offsets are immutable. A new publication changes latestOffset and
            // therefore the query key, so this particular lookup never needs to be repeated.
            staleTime: Number.POSITIVE_INFINITY,
            gcTime: Number.POSITIVE_INFINITY,
        })),
    });

    return {
        timestamps: queries.map((query) => query.data),
        isLoading: queries.some((query) => query.isLoading),
    };
}
