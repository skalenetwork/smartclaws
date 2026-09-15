import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address, Hex } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { useAccessGraph, useAllDevices } from "@/hooks/use-access-graph";
import { type ChannelKind, useChannelKinds } from "@/hooks/use-channel-kind";
import { AGENT_ROLES, DEVICE_ROLES } from "@/lib/roles";

export type ChannelDirection = "incoming" | "outgoing";

export interface ChannelSubject {
    address: Address;
    kind: "device" | "agent";
    /** deviceId / agentId; falls back to a shortened address. */
    name: string;
}

export interface ChannelInfo {
    address: Address;
    direction: ChannelDirection;
    subject: ChannelSubject;
    kind?: ChannelKind;
    /**
     * Wallets holding the role that writes to this channel. Undefined while loading. Capped at
     * MAX_WRITERS_READ; `writerCount` is the true total.
     */
    writers?: Address[];
    writerCount?: number;
}

// Devices and agents do not write their own channels; wallets holding a write role do.
// Outgoing is PUBLISHER_ROLE on both; incoming is MASTER_ROLE (commands to a device) or
// SENDER_ROLE (messages to an agent). Both contracts enumerate role members.
const WRITER_ROLES: Record<ChannelSubject["kind"], Record<ChannelDirection, Hex>> = {
    device: { outgoing: DEVICE_ROLES.PUBLISHER_ROLE, incoming: DEVICE_ROLES.MASTER_ROLE },
    agent: { outgoing: AGENT_ROLES.PUBLISHER_ROLE, incoming: AGENT_ROLES.SENDER_ROLE },
};
const DIRECTIONS: ChannelDirection[] = ["outgoing", "incoming"];
const MAX_WRITERS_READ = 5;
const FIELDS_PER_SUBJECT = 5;

export function subjectPath(subject: ChannelSubject, direction?: ChannelDirection) {
    const base = subject.kind === "device" ? "/devices" : "/agents";
    return `${base}/${subject.address}${direction ? `?tab=${direction}` : ""}`;
}

const abiFor = (kind: ChannelSubject["kind"]) => (kind === "device" ? abis.device : abis.agent);

/**
 * Every channel in the registry, named after the device or agent it belongs to, with the
 * wallets allowed to write to it. The registry lists channels as bare addresses; this is
 * what turns an event on one into something a person can read.
 */
export function useChannelDirectory() {
    const { agentAddresses, groupAddresses, isLoading: isLoadingGraph } = useAccessGraph();
    const { devices, isLoading: isLoadingDevices } = useAllDevices();

    const subjectRefs = useMemo(
        () => [
            ...devices.map((address) => ({ address, kind: "device" as const })),
            ...agentAddresses.map((address) => ({ address, kind: "agent" as const })),
        ],
        [devices, agentAddresses],
    );

    const { data, isLoading } = useReadContracts({
        contracts: subjectRefs.flatMap(({ address, kind }) => {
            const abi = abiFor(kind);
            return [
                {
                    address,
                    abi,
                    functionName: kind === "device" ? "deviceId" : "agentId",
                    chainId: chain.id,
                },
                { address, abi, functionName: "getIncomingMessagesChannel", chainId: chain.id },
                { address, abi, functionName: "getOutgoingMessagesChannel", chainId: chain.id },
                ...DIRECTIONS.map((direction) => ({
                    address,
                    abi,
                    functionName: "getRoleMemberCount",
                    args: [WRITER_ROLES[kind][direction]],
                    chainId: chain.id,
                })),
            ];
        }),
        query: {
            enabled: subjectRefs.length > 0,
            staleTime: 5 * 60_000,
            placeholderData: keepPreviousData,
        },
    });

    const base = useMemo(
        () =>
            subjectRefs.map(({ address, kind }, index) => {
                const at = (field: number) => data?.[index * FIELDS_PER_SUBJECT + field]?.result;
                const count = (field: number) => {
                    const value = at(field) as bigint | undefined;
                    return value === undefined ? undefined : Number(value);
                };
                return {
                    subject: {
                        address,
                        kind,
                        name:
                            (at(0) as string | undefined) ||
                            `${address.slice(0, 6)}…${address.slice(-4)}`,
                    } satisfies ChannelSubject,
                    channels: {
                        incoming: at(1) as Address | undefined,
                        outgoing: at(2) as Address | undefined,
                    },
                    writerCounts: { outgoing: count(3), incoming: count(4) },
                };
            }),
        [subjectRefs, data],
    );

    const memberRefs = useMemo(
        () =>
            base.flatMap((entry, subjectIndex) =>
                DIRECTIONS.flatMap((direction) =>
                    Array.from(
                        {
                            length: Math.min(entry.writerCounts[direction] ?? 0, MAX_WRITERS_READ),
                        },
                        (_, index) => ({ subjectIndex, direction, index }),
                    ),
                ),
            ),
        [base],
    );

    const { data: members, isLoading: isLoadingMembers } = useReadContracts({
        contracts: memberRefs.map(({ subjectIndex, direction, index }) => {
            const { subject } = base[subjectIndex];
            return {
                address: subject.address,
                abi: abiFor(subject.kind),
                functionName: "getRoleMember",
                args: [WRITER_ROLES[subject.kind][direction], BigInt(index)],
                chainId: chain.id,
            };
        }),
        query: {
            enabled: memberRefs.length > 0,
            staleTime: 5 * 60_000,
            placeholderData: keepPreviousData,
        },
    });

    const raw = useMemo(() => {
        const writers = new Map<string, Address[]>();
        memberRefs.forEach(({ subjectIndex, direction }, i) => {
            const wallet = members?.[i]?.result as Address | undefined;
            if (!wallet) return;
            const key = `${subjectIndex}:${direction}`;
            writers.set(key, [...(writers.get(key) ?? []), wallet]);
        });

        const list: Omit<ChannelInfo, "kind">[] = [];
        base.forEach(({ subject, channels, writerCounts }, subjectIndex) => {
            for (const direction of DIRECTIONS) {
                const address = channels[direction];
                if (!address) continue;
                const writerCount = writerCounts[direction];
                const found = writers.get(`${subjectIndex}:${direction}`) ?? [];
                const complete =
                    writerCount !== undefined &&
                    found.length >= Math.min(writerCount, MAX_WRITERS_READ);
                list.push({
                    address,
                    direction,
                    subject,
                    writerCount,
                    writers: complete ? found : undefined,
                });
            }
        });
        return list;
    }, [base, memberRefs, members]);

    const { kinds, isLoading: isLoadingKinds } = useChannelKinds(raw.map((c) => c.address));
    const kindsKey = kinds.join(",");

    // biome-ignore lint/correctness/useExhaustiveDependencies: `kinds` is a fresh array each render; its joined value is the real dependency
    const channels = useMemo<ChannelInfo[]>(
        () => raw.map((channel, index) => ({ ...channel, kind: kinds[index] })),
        [raw, kindsKey],
    );
    const subjects = useMemo(() => base.map((entry) => entry.subject), [base]);

    return {
        channels,
        subjects,
        groupAddresses,
        isLoading:
            isLoadingGraph || isLoadingDevices || isLoading || isLoadingMembers || isLoadingKinds,
    };
}
