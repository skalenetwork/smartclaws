import { decode } from "@smartclaws/core/envelope";
import { keepPreviousData } from "@tanstack/react-query";
import { type Address, type Hex, hexToBytes, zeroAddress } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain, registryAddress } from "@/config/wagmi";
import { useChannelActivityTimes } from "@/hooks/use-channel-activity";
import type { ChannelKind } from "@/hooks/use-channel-kind";
import { useChannelKinds } from "@/hooks/use-channel-kind";

export interface AgentInfo {
    address: Address;
    agentId?: string;
    metadata?: string;
    owner?: Address;
    /** `false` once the agent has been permanently deactivated. */
    active?: boolean;
    createdAt?: bigint;
    incomingChannel?: Address;
    outgoingChannel?: Address;
    channelKind?: ChannelKind;
    /** Latest offset on the outgoing channel — a proxy for "has it ever published". */
    outgoingOffset?: bigint;
    /** Timestamp of the newest outgoing message, for freshness display. */
    lastMessageTs?: number;
}

const FIELDS_PER_AGENT = 7;

/**
 * Lists every agent in the registry along with its lifecycle state.
 *
 * Note: the agent contract exposes `pause()`/`unpause()` but no `paused()` getter,
 * so a paused-but-active agent is indistinguishable from a running one on-chain.
 * `active` reflects only the permanent `deactivate()` flag.
 */
export function useAgents() {
    const { data: agentAddresses, isLoading: isLoadingList } = useReadContract({
        address: registryAddress,
        abi: abis.registry,
        functionName: "getAgents",
        chainId: chain.id,
        query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
    });

    const addresses = (agentAddresses as Address[] | undefined) ?? [];

    const { data: details, isLoading: isLoadingDetails } = useReadContracts({
        contracts: addresses.flatMap((address) => {
            const base = { address, abi: abis.agent, chainId: chain.id } as const;
            return [
                { ...base, functionName: "agentId" },
                { ...base, functionName: "metadata" },
                { ...base, functionName: "owner" },
                { ...base, functionName: "active" },
                { ...base, functionName: "createdAt" },
                { ...base, functionName: "getIncomingMessagesChannel" },
                { ...base, functionName: "getOutgoingMessagesChannel" },
            ];
        }),
        query: {
            enabled: addresses.length > 0,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const outgoingChannels = addresses.map(
        (_a, i) => details?.[i * FIELDS_PER_AGENT + 6]?.result as Address | undefined,
    );
    const channelKinds = useChannelKinds(outgoingChannels);

    const { data: offsets } = useReadContracts({
        contracts: outgoingChannels.map((channel) => ({
            address: channel ?? zeroAddress,
            abi: abis.channel,
            functionName: "getLatestMessageOffset",
            chainId: chain.id,
        })),
        query: {
            enabled: outgoingChannels.some((channel) => !!channel),
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    // Read the newest message from each outgoing channel to derive freshness.
    const { data: latestMessages } = useReadContracts({
        contracts: outgoingChannels.map((channel, i) => {
            const offset = offsets?.[i]?.result as bigint | undefined;
            return {
                address: channel ?? zeroAddress,
                abi: abis.channel,
                functionName: "readMessages",
                args: [offset ?? 0n, 1n],
                chainId: chain.id,
            };
        }),
        query: {
            enabled: offsets?.some((entry) => entry?.result !== undefined) ?? false,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const activity = useChannelActivityTimes(
        outgoingChannels.map((address, index) => ({
            address,
            latestOffset: offsets?.[index]?.result as bigint | undefined,
            enabled: channelKinds.kinds[index] === "encrypted",
        })),
    );

    const agents: AgentInfo[] = addresses.map((address, i) => {
        const at = (offset: number) => details?.[i * FIELDS_PER_AGENT + offset]?.result;

        let lastMessageTs = activity.timestamps[i];
        try {
            const raw = latestMessages?.[i]?.result as [Hex[], bigint[]] | undefined;
            if (channelKinds.kinds[i] === "plain" && raw?.[0]?.[0]) {
                lastMessageTs = decode(hexToBytes(raw[0][0])).ts;
            }
        } catch {
            // ignore decode errors — a non-envelope payload just has no timestamp
        }

        return {
            address,
            agentId: at(0) as string | undefined,
            metadata: at(1) as string | undefined,
            owner: at(2) as Address | undefined,
            active: at(3) as boolean | undefined,
            createdAt: at(4) as bigint | undefined,
            incomingChannel: at(5) as Address | undefined,
            outgoingChannel: at(6) as Address | undefined,
            channelKind: channelKinds.kinds[i],
            outgoingOffset: offsets?.[i]?.result as bigint | undefined,
            lastMessageTs,
        };
    });

    return {
        agents,
        activeCount: agents.filter((a) => a.active === true).length,
        totalCount: addresses.length,
        isLoading: isLoadingList || isLoadingDetails || channelKinds.isLoading,
    };
}
