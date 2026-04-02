import { keepPreviousData } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain, registryAddress } from "@/config/wagmi";

export function useRegistryStats() {
  const contract = { address: registryAddress, abi: abis.registry, chainId: chain.id } as const;

  const result = useReadContracts({
    contracts: [
      { ...contract, functionName: "getDeviceGroupCount" },
      { ...contract, functionName: "getAgentCount" },
      { ...contract, functionName: "getChannelCount" },
    ],
    query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
  });

  return {
    groupCount: result.data?.[0]?.result as bigint | undefined,
    agentCount: result.data?.[1]?.result as bigint | undefined,
    channelCount: result.data?.[2]?.result as bigint | undefined,
    isLoading: result.isLoading,
  };
}
