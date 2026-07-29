import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export function useDeviceDetail(deviceAddress: Address) {
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

    return {
        incomingChannel: data?.[0]?.result as Address | undefined,
        outgoingChannel: data?.[1]?.result as Address | undefined,
        deviceId: data?.[2]?.result as string | undefined,
        group: data?.[3]?.result as Address | undefined,
        createdAt: data?.[4]?.result as bigint | undefined,
        isLoading,
    };
}
