import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { type AccountLabel, useAccessGraph } from "@/hooks/use-access-graph";
import { ROLE_ORDER, type RoleName, roleHash, type SubjectKind } from "@/lib/roles";

export interface AccessHolder {
    account: Address;
    label: string;
    kind: AccountLabel["kind"];
    roles: RoleName[];
    /** True if any held role permits writing messages. */
    canWrite: boolean;
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
): {
    holders: AccessHolder[];
    candidateCount: number;
    isLoading: boolean;
} {
    const { candidates, isLoading: isLoadingGraph } = useAccessGraph();
    const roles = ROLE_ORDER[kind];
    const abi = kind === "device" ? abis.device : abis.agent;

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

    return {
        holders,
        candidateCount: candidates.length,
        isLoading: isLoadingGraph || isLoading,
    };
}
