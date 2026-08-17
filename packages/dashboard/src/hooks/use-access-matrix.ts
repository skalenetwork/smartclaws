import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { useAccessGraph, useAllDevices } from "@/hooks/use-access-graph";
import { useChannelKinds } from "@/hooks/use-channel-kind";
import {
    type ReaderDirection,
    ROLE_ORDER,
    type RoleName,
    roleHash,
    type SubjectKind,
} from "@/lib/roles";

export interface SubjectRef {
    address: Address;
    kind: SubjectKind;
    label: string;
}

export interface AccessGrant {
    subject: SubjectRef;
    roles: RoleName[];
}

export interface ReaderGrant {
    subject: SubjectRef;
    directions: ReaderDirection[];
}

export interface AccessMatrixRow {
    account: Address;
    label: string;
    grants: AccessGrant[];
    readerGrants: ReaderGrant[];
    canWriteSomewhere: boolean;
}

/**
 * Inverts the permission model: for every account in the registry graph, lists
 * which devices and agents it holds roles on.
 *
 * Cost is (candidates x subjects x roles) `hasRole` reads, batched by wagmi into
 * multicalls. Fine for a homelab-scale registry; would need pagination if the
 * graph grows to hundreds of subjects.
 */
export function useAccessMatrix() {
    const { candidates, agentAddresses, isLoading: isLoadingGraph } = useAccessGraph();
    const { devices, isLoading: isLoadingDevices } = useAllDevices();

    // Build the subject list (devices + agents) with labels from the graph.
    const subjects = useMemo<SubjectRef[]>(() => {
        const labelFor = (address: Address, fallback: string) =>
            candidates.find((c) => c.address.toLowerCase() === address.toLowerCase())?.label ??
            fallback;

        return [
            ...devices.map((address) => ({
                address,
                kind: "device" as const,
                label: labelFor(address, "device"),
            })),
            ...agentAddresses.map((address) => ({
                address,
                kind: "agent" as const,
                label: labelFor(address, "agent"),
            })),
        ];
    }, [devices, agentAddresses, candidates]);

    // Every (subject, role, candidate) triple we need to probe.
    const probes = useMemo(
        () =>
            subjects.flatMap((subject) =>
                ROLE_ORDER[subject.kind].flatMap((role) =>
                    candidates.map((candidate) => ({ subject, role, candidate })),
                ),
            ),
        [subjects, candidates],
    );

    const { data: subjectChannelData, isLoading: isLoadingSubjectChannels } = useReadContracts({
        contracts: subjects.flatMap((subject) => {
            const abi = subject.kind === "device" ? abis.device : abis.agent;
            return [
                {
                    address: subject.address,
                    abi,
                    functionName: "getIncomingMessagesChannel",
                    chainId: chain.id,
                },
                {
                    address: subject.address,
                    abi,
                    functionName: "getOutgoingMessagesChannel",
                    chainId: chain.id,
                },
            ];
        }),
        query: {
            enabled: subjects.length > 0,
            staleTime: Number.POSITIVE_INFINITY,
        },
    });

    const channelRefs = useMemo(
        () =>
            subjects.flatMap((subject, index) => [
                {
                    subject,
                    direction: "incoming" as const,
                    address: subjectChannelData?.[index * 2]?.result as Address | undefined,
                },
                {
                    subject,
                    direction: "outgoing" as const,
                    address: subjectChannelData?.[index * 2 + 1]?.result as Address | undefined,
                },
            ]),
        [subjects, subjectChannelData],
    );
    const channelKinds = useChannelKinds(channelRefs.map((ref) => ref.address));

    const { data: readerData, isLoading: isLoadingReaders } = useReadContracts({
        contracts: channelRefs.map((ref) => ({
            address: ref.address,
            abi: abis.channelEncrypted,
            functionName: "getReaders",
            args: [],
            chainId: chain.id,
        })),
        query: {
            enabled: channelRefs.some(
                (ref, index) => !!ref.address && channelKinds.kinds[index] === "encrypted",
            ),
            refetchInterval: 60_000,
            placeholderData: keepPreviousData,
        },
    });

    const { data, isLoading } = useReadContracts({
        contracts: probes.map(({ subject, role, candidate }) => ({
            address: subject.address,
            abi: subject.kind === "device" ? abis.device : abis.agent,
            functionName: "hasRole",
            args: [roleHash(subject.kind, role), candidate.address],
            chainId: chain.id,
        })),
        query: {
            enabled: probes.length > 0,
            refetchInterval: 60_000,
            placeholderData: keepPreviousData,
        },
    });

    const rows = useMemo<AccessMatrixRow[]>(() => {
        const byAccount = new Map<string, AccessMatrixRow>();

        probes.forEach(({ subject, role, candidate }, i) => {
            if (data?.[i]?.result !== true) return;

            const accountKey = candidate.address.toLowerCase();
            let row = byAccount.get(accountKey);
            if (!row) {
                row = {
                    account: candidate.address,
                    label: candidate.label,
                    grants: [],
                    readerGrants: [],
                    canWriteSomewhere: false,
                };
                byAccount.set(accountKey, row);
            }

            const subjectKey = `${subject.address.toLowerCase()}-${subject.kind}`;
            let grant = row.grants.find(
                (g) => `${g.subject.address.toLowerCase()}-${g.subject.kind}` === subjectKey,
            );
            if (!grant) {
                grant = { subject, roles: [] };
                row.grants.push(grant);
            }
            grant.roles.push(role);
        });

        channelRefs.forEach((ref, index) => {
            if (channelKinds.kinds[index] !== "encrypted") return;
            const readers = (readerData?.[index]?.result as Address[] | undefined) ?? [];
            for (const account of readers) {
                const accountKey = account.toLowerCase();
                let row = byAccount.get(accountKey);
                if (!row) {
                    const candidate = candidates.find(
                        (entry) => entry.address.toLowerCase() === accountKey,
                    );
                    row = {
                        account,
                        label: candidate?.label ?? "external reader",
                        grants: [],
                        readerGrants: [],
                        canWriteSomewhere: false,
                    };
                    byAccount.set(accountKey, row);
                }
                let grant = row.readerGrants.find(
                    (entry) =>
                        entry.subject.address.toLowerCase() === ref.subject.address.toLowerCase(),
                );
                if (!grant) {
                    grant = { subject: ref.subject, directions: [] };
                    row.readerGrants.push(grant);
                }
                if (!grant.directions.includes(ref.direction)) {
                    grant.directions.push(ref.direction);
                }
            }
        });

        const result = [...byAccount.values()];
        for (const row of result) {
            for (const grant of row.grants) {
                const order = ROLE_ORDER[grant.subject.kind];
                grant.roles.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                // The first two entries of ROLE_ORDER are the write roles.
                if (grant.roles.some((role) => order.indexOf(role) < 2)) {
                    row.canWriteSomewhere = true;
                }
            }
            row.grants.sort((a, b) => a.subject.label.localeCompare(b.subject.label));
        }

        return result.sort(
            (a, b) =>
                Number(b.canWriteSomewhere) - Number(a.canWriteSomewhere) ||
                b.grants.length - a.grants.length ||
                a.label.localeCompare(b.label),
        );
    }, [probes, data, channelRefs, channelKinds.kinds, readerData, candidates]);

    return {
        rows,
        subjectCount: subjects.length,
        isLoading:
            isLoadingGraph ||
            isLoadingDevices ||
            isLoading ||
            isLoadingSubjectChannels ||
            channelKinds.isLoading ||
            isLoadingReaders,
    };
}
