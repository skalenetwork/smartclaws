import { keepPreviousData } from "@tanstack/react-query";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export interface ChannelCapacity {
    totalBytes?: bigint;
    maxCapacityBytes?: bigint;
    messageCount?: bigint;
    startOffset?: bigint;
    nextOffset?: bigint;
    paused?: boolean;
    writesEnabled?: boolean;
    /** 0–100 fill percentage, or undefined while loading. */
    fillPercent?: number;
    /**
     * True once the circular buffer has begun evicting. The channel keeps
     * accepting writes — this means the oldest history is no longer readable.
     */
    hasPruned?: boolean;
    isLoading: boolean;
}

export function useChannelCapacity(channel: Address | undefined): ChannelCapacity {
    const contract = { address: channel, abi: abis.channel, chainId: chain.id } as const;

    const { data, isLoading } = useReadContracts({
        contracts: [
            { ...contract, functionName: "totalBytes" },
            { ...contract, functionName: "maxCapacityBytes" },
            { ...contract, functionName: "getMessageCount" },
            { ...contract, functionName: "startOffset" },
            { ...contract, functionName: "nextOffset" },
            { ...contract, functionName: "paused" },
            { ...contract, functionName: "writesEnabled" },
        ],
        query: {
            enabled: !!channel,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const totalBytes = data?.[0]?.result as bigint | undefined;
    const maxCapacityBytes = data?.[1]?.result as bigint | undefined;
    const startOffset = data?.[3]?.result as bigint | undefined;

    const fillPercent =
        totalBytes !== undefined && maxCapacityBytes !== undefined && maxCapacityBytes > 0n
            ? Number((totalBytes * 10000n) / maxCapacityBytes) / 100
            : undefined;

    return {
        totalBytes,
        maxCapacityBytes,
        messageCount: data?.[2]?.result as bigint | undefined,
        startOffset,
        nextOffset: data?.[4]?.result as bigint | undefined,
        paused: data?.[5]?.result as boolean | undefined,
        writesEnabled: data?.[6]?.result as boolean | undefined,
        fillPercent,
        hasPruned: startOffset === undefined ? undefined : startOffset > 0n,
        isLoading,
    };
}
