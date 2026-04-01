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
      { ...contract, functionName: "publisher" },
      { ...contract, functionName: "group" },
    ],
    query: { refetchInterval: 15_000 },
  });

  return {
    incomingChannel: data?.[0]?.result as Address | undefined,
    outgoingChannel: data?.[1]?.result as Address | undefined,
    publisher: data?.[2]?.result as Address | undefined,
    group: data?.[3]?.result as Address | undefined,
    isLoading,
  };
}
