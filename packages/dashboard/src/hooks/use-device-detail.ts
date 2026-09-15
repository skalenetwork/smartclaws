import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { type ChannelKind, useChannelKind } from "@/hooks/use-channel-kind";
import { DEVICE_ROLES } from "@/lib/roles";

export function useDeviceDetail(deviceAddress: Address, knownKind?: ChannelKind) {
    const contract = { address: deviceAddress, abi: abis.device, chainId: chain.id } as const;

    const { data, isLoading } = useReadContracts({
        contracts: [
            { ...contract, functionName: "getIncomingMessagesChannel" },
            { ...contract, functionName: "getOutgoingMessagesChannel" },
            { ...contract, functionName: "deviceId" },
            { ...contract, functionName: "group" },
            { ...contract, functionName: "createdAt" },
            // SmartClawsDevice has no `owner()` — it is AccessControlEnumerable, and the
            // account that controls it is the DEVICE_ADMIN_ROLE holder (the group holds
            // DEFAULT_ADMIN above it). The constructor grants exactly one, but the role is
            // revocable and re-grantable, so read the count too rather than assuming one.
            {
                ...contract,
                functionName: "getRoleMemberCount",
                args: [DEVICE_ROLES.DEVICE_ADMIN_ROLE],
            },
            {
                ...contract,
                functionName: "getRoleMember",
                args: [DEVICE_ROLES.DEVICE_ADMIN_ROLE, 0n],
            },
        ],
        query: { refetchInterval: 15_000 },
    });

    const incomingChannel = data?.[0]?.result as Address | undefined;
    const outgoingChannel = data?.[1]?.result as Address | undefined;
    const { kind: channelKind, isLoading: isLoadingKind } = useChannelKind(
        outgoingChannel,
        knownKind,
    );

    // `getRoleMember(role, 0)` reverts when the role is empty; useReadContracts reports
    // that as a failed entry, so gate on the count rather than trusting the result.
    const adminCount = Number((data?.[5]?.result as bigint | undefined) ?? 0n);

    return {
        incomingChannel,
        outgoingChannel,
        channelKind,
        deviceId: data?.[2]?.result as string | undefined,
        group: data?.[3]?.result as Address | undefined,
        createdAt: data?.[4]?.result as bigint | undefined,
        /** First DEVICE_ADMIN_ROLE holder — the device's closest equivalent to an owner. */
        admin: adminCount > 0 ? (data?.[6]?.result as Address | undefined) : undefined,
        adminCount,
        isLoading: isLoading || isLoadingKind,
    };
}
