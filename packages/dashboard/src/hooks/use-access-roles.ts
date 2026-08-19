import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { type AccountLabel, useAccessGraph } from "@/hooks/use-access-graph";
import { type ChannelKind, useChannelKinds } from "@/hooks/use-channel-kind";
import {
    type ReaderDirection,
    ROLE_ORDER,
    type RoleName,
    roleHash,
    type SubjectKind,
} from "@/lib/roles";

export interface AccessHolder {
    account: Address;
    label: string;
    kind: AccountLabel["kind"];
    roles: RoleName[];
    /** True if any held role permits writing messages. */
    canWrite: boolean;
}

export interface AccessReader {
    account: Address;
    label: string;
    directions: ReaderDirection[];
}

/**
 * Resolves who currently holds which role on a device or agent, using only
 * `hasRole` reads against the registry-graph candidate set.
 *
 * See `useAccessGraph` for why enumeration and log replay are not options here.
 */
export function useAccessRoles(
    subject: Address | undefined,
    kind: SubjectKind,
    knownChannelKind?: ChannelKind,
): {
    holders: AccessHolder[];
    readers: AccessReader[];
    candidateCount: number;
    isLoading: boolean;
} {
    const { candidates, isLoading: isLoadingGraph } = useAccessGraph();
    const roles = ROLE_ORDER[kind];
    const abi = kind === "device" ? abis.device : abis.agent;

    const { data: channelData, isLoading: isLoadingChannels } = useReadContracts({
        contracts: [
            {
                address: subject,
                abi,
                functionName: "getIncomingMessagesChannel",
                chainId: chain.id,
            },
            {
                address: subject,
                abi,
                functionName: "getOutgoingMessagesChannel",
                chainId: chain.id,
            },
        ],
        query: { enabled: !!subject, staleTime: Number.POSITIVE_INFINITY },
    });
    const channels = [
        channelData?.[0]?.result as Address | undefined,
        channelData?.[1]?.result as Address | undefined,
    ];
    const resolvedKinds = useChannelKinds(knownChannelKind ? [] : channels);
    const channelKinds = knownChannelKind
        ? [knownChannelKind, knownChannelKind]
        : resolvedKinds.kinds;

    const { data: readerData, isLoading: isLoadingReaders } = useReadContracts({
        contracts: channels.map((address) => ({
            address,
            abi: abis.channelEncrypted,
            functionName: "getReaders",
            args: [],
            chainId: chain.id,
        })),
        query: {
            enabled: channels.some(
                (address, index) => !!address && channelKinds[index] === "encrypted",
            ),
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    // One hasRole read per (candidate, role) pair.
    const pairs = useMemo(
        () => candidates.flatMap((candidate) => roles.map((role) => ({ candidate, role }))),
        [candidates, roles],
    );

    const { data, isLoading } = useReadContracts({
        contracts: pairs.map(({ candidate, role }) => ({
            address: subject ?? "0x0000000000000000000000000000000000000000",
            abi,
            functionName: "hasRole",
            args: [roleHash(kind, role), candidate.address],
            chainId: chain.id,
        })),
        query: {
            enabled: !!subject && pairs.length > 0,
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    const holders = useMemo(() => {
        const byAccount = new Map<string, AccessHolder>();

        pairs.forEach(({ candidate, role }, i) => {
            if (data?.[i]?.result !== true) return;
            const key = candidate.address.toLowerCase();
            const existing = byAccount.get(key);
            if (existing) {
                existing.roles.push(role);
                return;
            }
            byAccount.set(key, {
                account: candidate.address,
                label: candidate.label,
                kind: candidate.kind,
                roles: [role],
                canWrite: false,
            });
        });

        const result = [...byAccount.values()];
        for (const holder of result) {
            // Preserve ROLE_ORDER, then derive the write flag.
            holder.roles.sort((a, b) => roles.indexOf(a) - roles.indexOf(b));
            holder.canWrite = holder.roles.some((role) => roles.indexOf(role) < 2);
        }
        // Write-capable accounts first, then by label.
        return result.sort(
            (a, b) => Number(b.canWrite) - Number(a.canWrite) || a.label.localeCompare(b.label),
        );
    }, [pairs, data, roles]);

    const readers = useMemo<AccessReader[]>(() => {
        const byAccount = new Map<string, AccessReader>();
        const directions: ReaderDirection[] = ["incoming", "outgoing"];

        directions.forEach((direction, index) => {
            if (channelKinds[index] !== "encrypted") return;
            const addresses = (readerData?.[index]?.result as Address[] | undefined) ?? [];
            for (const account of addresses) {
                const key = account.toLowerCase();
                const known = candidates.find(
                    (candidate) => candidate.address.toLowerCase() === key,
                );
                const existing = byAccount.get(key);
                if (existing) {
                    existing.directions.push(direction);
                } else {
                    byAccount.set(key, {
                        account,
                        label: known?.label ?? "external reader",
                        directions: [direction],
                    });
                }
            }
        });
        return [...byAccount.values()].sort((a, b) => a.label.localeCompare(b.label));
    }, [candidates, channelKinds, readerData]);

    return {
        holders,
        readers,
        candidateCount: candidates.length,
        isLoading:
            isLoadingGraph ||
            isLoading ||
            isLoadingChannels ||
            resolvedKinds.isLoading ||
            isLoadingReaders,
    };
}
