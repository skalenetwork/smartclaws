import { decode } from "@smartclaws/core/envelope";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Address, type Hex, hexToBytes, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export interface DeviceInfo {
    address: Address;
    deviceId?: string;
    incomingChannel: Address;
    outgoingChannel: Address;
    createdAt?: bigint;
    lastMessageTs?: number;
    devName?: string;
}

export function useGroupDetail(groupAddress: Address) {
    const contract = { address: groupAddress, abi: abis.deviceGroup, chainId: chain.id } as const;

    const { data: meta, isLoading: isLoadingMeta } = useReadContracts({
        contracts: [
            { ...contract, functionName: "groupName" },
            { ...contract, functionName: "skills" },
            { ...contract, functionName: "active" },
            { ...contract, functionName: "owner" },
            { ...contract, functionName: "getDevices" },
        ],
        query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
    });

    const groupName = meta?.[0]?.result as string | undefined;
    const skills = meta?.[1]?.result as string | undefined;
    const active = meta?.[2]?.result as boolean | undefined;
    const owner = meta?.[3]?.result as Address | undefined;
    const deviceAddresses = (meta?.[4]?.result as Address[] | undefined) ?? [];

    const { data: deviceDetails, isLoading: isLoadingDevices } = useReadContracts({
        contracts: deviceAddresses.flatMap((addr) => [
            { address: addr, abi: abis.device, functionName: "deviceId", chainId: chain.id },
            {
                address: addr,
                abi: abis.device,
                functionName: "getIncomingMessagesChannel",
                chainId: chain.id,
            },
            {
                address: addr,
                abi: abis.device,
                functionName: "getOutgoingMessagesChannel",
                chainId: chain.id,
            },
            { address: addr, abi: abis.device, functionName: "createdAt", chainId: chain.id },
        ]),
        query: {
            enabled: deviceAddresses.length > 0,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const outgoingChannels = useMemo(() => {
        return deviceAddresses.map((_addr, i) => {
            return deviceDetails?.[i * 4 + 2]?.result as Address | undefined;
        });
    }, [deviceAddresses, deviceDetails]);

    // Get latest message offset for each outgoing channel
    const { data: latestOffsets } = useReadContracts({
        contracts: outgoingChannels.map((ch) => ({
            address: ch ?? zeroAddress,
            abi: abis.channel,
            functionName: "getLatestMessageOffset",
            chainId: chain.id,
        })),
        query: {
            enabled: outgoingChannels.length > 0 && outgoingChannels.every((ch) => !!ch),
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    // Read the latest message from each channel
    const { data: latestMessages } = useReadContracts({
        contracts: outgoingChannels.map((ch, i) => {
            const offset = latestOffsets?.[i]?.result as bigint | undefined;
            return {
                address: ch ?? zeroAddress,
                abi: abis.channel,
                functionName: "readMessages",
                args: [offset ?? 0n, 1n],
                chainId: chain.id,
            };
        }),
        query: {
            enabled: latestOffsets?.some((r) => r?.result !== undefined) ?? false,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const devices: DeviceInfo[] = deviceAddresses.map((addr, i) => {
        const deviceId = deviceDetails?.[i * 4]?.result as string | undefined;
        const incomingChannel = deviceDetails?.[i * 4 + 1]?.result as Address | undefined;
        const outgoingChannel = deviceDetails?.[i * 4 + 2]?.result as Address | undefined;
        const createdAt = deviceDetails?.[i * 4 + 3]?.result as bigint | undefined;

        let lastMessageTs: number | undefined;
        let devName: string | undefined;
        try {
            const raw = latestMessages?.[i]?.result as [Hex[], bigint[]] | undefined;
            if (raw?.[0]?.[0]) {
                const envelope = decode(hexToBytes(raw[0][0]));
                lastMessageTs = envelope.ts;
                devName = envelope.dev;
            }
        } catch {
            // ignore decode errors
        }

        return {
            address: addr,
            deviceId,
            incomingChannel: incomingChannel ?? zeroAddress,
            outgoingChannel: outgoingChannel ?? zeroAddress,
            createdAt,
            lastMessageTs,
            devName: devName ?? deviceId,
        };
    });

    return {
        groupName,
        skills,
        active,
        owner,
        devices,
        isLoading: isLoadingMeta || isLoadingDevices,
    };
}
