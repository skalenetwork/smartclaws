import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { type ChannelKind, useChannelKind } from "@/hooks/use-channel-kind";

export function useDeviceDetail(deviceAddress: Address, knownKind?: ChannelKind) {
    const contract = { address: deviceAddress, abi: abis.device, chainId: chain.id } as const;

    const { data, isLoading } = useReadContracts({
        contracts: [
            { ...contract, functionName: "getIncomingMessagesChannel" },
            { ...contract, functionName: "getOutgoingMessagesChannel" },
            { ...contract, functionName: "deviceId" },
            { ...contract, functionName: "group" },
            { ...contract, functionName: "createdAt" },
        ],
        query: { refetchInterval: 15_000 },
    });

    const incomingChannel = data?.[0]?.result as Address | undefined;
    const outgoingChannel = data?.[1]?.result as Address | undefined;
    const { kind: channelKind, isLoading: isLoadingKind } = useChannelKind(
        outgoingChannel,
        knownKind,
    );

    return {
        incomingChannel,
        outgoingChannel,
        channelKind,
        deviceId: data?.[2]?.result as string | undefined,
        group: data?.[3]?.result as Address | undefined,
        createdAt: data?.[4]?.result as bigint | undefined,
        isLoading: isLoading || isLoadingKind,
    };
}
