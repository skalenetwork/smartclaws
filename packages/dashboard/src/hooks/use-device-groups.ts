import { keepPreviousData } from "@tanstack/react-query";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain, registryAddress } from "@/config/wagmi";

export interface DeviceGroupSummary {
    address: Address;
    groupName: string;
    skills: string;
    active: boolean;
    owner: Address;
    deviceCount: bigint;
}

export function useDeviceGroups() {
    const { data: groupAddresses, isLoading: isLoadingAddresses } = useReadContract({
        address: registryAddress,
        abi: abis.registry,
        functionName: "getDeviceGroups",
        chainId: chain.id,
        query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
    });

    const addresses = (groupAddresses as Address[] | undefined) ?? [];

    const { data: details, isLoading: isLoadingDetails } = useReadContracts({
        contracts: addresses.flatMap((addr) => [
            { address: addr, abi: abis.deviceGroup, functionName: "groupName", chainId: chain.id },
            { address: addr, abi: abis.deviceGroup, functionName: "skills", chainId: chain.id },
            { address: addr, abi: abis.deviceGroup, functionName: "active", chainId: chain.id },
            { address: addr, abi: abis.deviceGroup, functionName: "owner", chainId: chain.id },
            {
                address: addr,
                abi: abis.deviceGroup,
                functionName: "getDeviceCount",
                chainId: chain.id,
            },
        ]),
        query: {
            enabled: addresses.length > 0,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const groups: DeviceGroupSummary[] = addresses.map((addr, i) => ({
        address: addr,
        groupName: (details?.[i * 5]?.result as string) ?? "",
        skills: (details?.[i * 5 + 1]?.result as string) ?? "",
        active: (details?.[i * 5 + 2]?.result as boolean) ?? false,
        owner: (details?.[i * 5 + 3]?.result as Address) ?? "0x",
        deviceCount: (details?.[i * 5 + 4]?.result as bigint) ?? 0n,
    }));

    return {
        groups,
        isLoading: isLoadingAddresses || isLoadingDetails,
    };
}
