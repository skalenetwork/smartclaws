import { decode } from "@smartclaws/core/envelope";
import { keepPreviousData } from "@tanstack/react-query";
import { type Address, type Hex, hexToBytes, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

/** Metadata and liveness for a single agent. */
export function useAgentDetail(agentAddress: Address) {
    const contract = { address: agentAddress, abi: abis.agent, chainId: chain.id } as const;

    const { data, isLoading } = useReadContracts({
        contracts: [
            { ...contract, functionName: "agentId" },
            { ...contract, functionName: "metadata" },
            { ...contract, functionName: "owner" },
            { ...contract, functionName: "active" },
            { ...contract, functionName: "createdAt" },
            { ...contract, functionName: "getIncomingMessagesChannel" },
            { ...contract, functionName: "getOutgoingMessagesChannel" },
        ],
        query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
    });

    const outgoingChannel = data?.[6]?.result as Address | undefined;

    const { data: offsetData } = useReadContracts({
        contracts: [
            {
                address: outgoingChannel ?? zeroAddress,
                abi: abis.channel,
                functionName: "getLatestMessageOffset",
                chainId: chain.id,
            },
        ],
        query: {
            enabled: !!outgoingChannel,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const latestOffset = offsetData?.[0]?.result as bigint | undefined;

    const { data: messageData } = useReadContracts({
        contracts: [
            {
                address: outgoingChannel ?? zeroAddress,
                abi: abis.channel,
                functionName: "readMessages",
                args: [latestOffset ?? 0n, 1n],
                chainId: chain.id,
            },
        ],
        query: {
            enabled: !!outgoingChannel && latestOffset !== undefined,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    let lastMessageTs: number | undefined;
    try {
        const raw = messageData?.[0]?.result as [Hex[], bigint[]] | undefined;
        if (raw?.[0]?.[0]) lastMessageTs = decode(hexToBytes(raw[0][0])).ts;
    } catch {
        // ignore decode errors
    }

    return {
        agentId: data?.[0]?.result as string | undefined,
        metadata: data?.[1]?.result as string | undefined,
        owner: data?.[2]?.result as Address | undefined,
        active: data?.[3]?.result as boolean | undefined,
        createdAt: data?.[4]?.result as bigint | undefined,
        incomingChannel: data?.[5]?.result as Address | undefined,
        outgoingChannel,
        lastMessageTs,
        isLoading,
    };
}
