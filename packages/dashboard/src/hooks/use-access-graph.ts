import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain, registryAddress } from "@/config/wagmi";

export interface AccountLabel {
    address: Address;
    /** Short human label, e.g. "owner of home" or "master-1". */
    label: string;
    kind: "registry" | "group" | "group-owner" | "agent" | "agent-owner" | "device";
}

/**
 * Enumerates every account and contract in the registry graph.
 *
 * This is the candidate set used for permission checks. SmartClawsDevice and
 * SmartClawsAgent use plain `AccessControl` (not `AccessControlEnumerable`), so
 * role holders cannot be listed on-chain; and this RPC prunes old blocks, so
 * reconstructing them from RoleGranted logs is not reliable either. Instead we
 * derive the realistic actors from the graph and probe each with `hasRole`,
 * which is pure reads and cannot break on pruning.
 *
 * Trade-off: an account granted a role but not present anywhere in the graph
 * (a bare EOA nobody references) will not appear. `useAccessRoles` returns
 * `candidateCount` so the UI can state how many accounts were actually checked.
 */
export function useAccessGraph() {
    const registry = { address: registryAddress, abi: abis.registry, chainId: chain.id } as const;

    const { data: lists, isLoading: isLoadingLists } = useReadContracts({
        contracts: [
            { ...registry, functionName: "getAgents" },
            { ...registry, functionName: "getDeviceGroups" },
        ],
        query: { refetchInterval: 30_000, placeholderData: keepPreviousData },
    });

    const agentAddresses = (lists?.[0]?.result as Address[] | undefined) ?? [];
    const groupAddresses = (lists?.[1]?.result as Address[] | undefined) ?? [];

    // Owners + identity for each agent, and owner/name/devices for each group.
    const { data: agentInfo } = useReadContracts({
        contracts: agentAddresses.flatMap((address) => [
            { address, abi: abis.agent, functionName: "owner", chainId: chain.id },
            { address, abi: abis.agent, functionName: "agentId", chainId: chain.id },
        ]),
        query: {
            enabled: agentAddresses.length > 0,
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    const { data: groupInfo } = useReadContracts({
        contracts: groupAddresses.flatMap((address) => [
            { address, abi: abis.deviceGroup, functionName: "owner", chainId: chain.id },
            { address, abi: abis.deviceGroup, functionName: "groupName", chainId: chain.id },
            { address, abi: abis.deviceGroup, functionName: "getDevices", chainId: chain.id },
            {
                address,
                abi: abis.deviceGroup,
                functionName: "getEncryptedDevices",
                chainId: chain.id,
            },
        ]),
        query: {
            enabled: groupAddresses.length > 0,
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    const candidates = useMemo(() => {
        const byAddress = new Map<string, AccountLabel>();
        const add = (address: Address | undefined, label: string, kind: AccountLabel["kind"]) => {
            if (!address) return;
            const key = address.toLowerCase();
            // First label wins — group owner beats a later generic entry.
            if (!byAddress.has(key)) byAddress.set(key, { address, label, kind });
        };

        add(registryAddress, "registry", "registry");

        groupAddresses.forEach((address, i) => {
            const owner = groupInfo?.[i * 4]?.result as Address | undefined;
            const name = (groupInfo?.[i * 4 + 1]?.result as string | undefined) ?? "group";
            const devices = [
                ...((groupInfo?.[i * 4 + 2]?.result as Address[] | undefined) ?? []),
                ...((groupInfo?.[i * 4 + 3]?.result as Address[] | undefined) ?? []),
            ];
            add(address, `group ${name}`, "group");
            add(owner, `owner of ${name}`, "group-owner");
            for (const device of devices) add(device, "device", "device");
        });

        agentAddresses.forEach((address, i) => {
            const owner = agentInfo?.[i * 2]?.result as Address | undefined;
            const agentId = (agentInfo?.[i * 2 + 1]?.result as string | undefined) ?? "agent";
            add(address, agentId, "agent");
            add(owner, `wallet of ${agentId}`, "agent-owner");
        });

        return [...byAddress.values()];
    }, [agentAddresses, groupAddresses, agentInfo, groupInfo]);

    return {
        candidates,
        agentAddresses,
        groupAddresses,
        isLoading: isLoadingLists,
    };
}

/** Convenience: enumerate every device across every group. */
export function useAllDevices() {
    const { data: groups } = useReadContract({
        address: registryAddress,
        abi: abis.registry,
        functionName: "getDeviceGroups",
        chainId: chain.id,
        query: { refetchInterval: 30_000, placeholderData: keepPreviousData },
    });

    const groupAddresses = (groups as Address[] | undefined) ?? [];

    const { data: deviceLists, isLoading } = useReadContracts({
        contracts: groupAddresses.flatMap((address) => [
            {
                address,
                abi: abis.deviceGroup,
                functionName: "getDevices",
                chainId: chain.id,
            },
            {
                address,
                abi: abis.deviceGroup,
                functionName: "getEncryptedDevices",
                chainId: chain.id,
            },
        ]),
        query: {
            enabled: groupAddresses.length > 0,
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    const devices = useMemo(() => {
        const byAddress = new Map<string, Address>();
        for (const entry of deviceLists ?? []) {
            for (const address of (entry?.result as Address[] | undefined) ?? []) {
                byAddress.set(address.toLowerCase(), address);
            }
        }
        return [...byAddress.values()];
    }, [deviceLists]);

    return { devices, isLoading };
}
