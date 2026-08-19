import { decode } from "@smartclaws/core/envelope";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Address, type Hex, hexToBytes, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";
import { useAllDevices } from "@/hooks/use-access-graph";
import { type AgentInfo, useAgents } from "@/hooks/use-agents";
import { useChannelActivityTimes } from "@/hooks/use-channel-activity";
import { useChannelKinds } from "@/hooks/use-channel-kind";
import { DEVICE_ROLES } from "@/lib/roles";

export interface AgentLiveness {
    /** Freshest activity timestamp attributable to this agent, if any. */
    lastActivityTs?: number;
    /** Where that timestamp came from, e.g. "thermal-sensor-1 telemetry". */
    source?: string;
}

interface DeviceRef {
    address: Address;
    deviceId?: string;
    incoming?: Address;
    outgoing?: Address;
}

const DEVICE_FIELDS = 3;

/**
 * Derives agent liveness from what the agent's owner wallet is actually doing,
 * not just from the agent's own channel.
 *
 * A telemetry-only bridge writes to its *device* channel, and only writes to its
 * *agent* channel on failures (or when AGENT_LOG_CYCLES=1). Judging it by the
 * agent channel alone marks a healthy bridge as dead, so we also consider every
 * device channel the owner is authorised to write to.
 *
 * Attribution caveat: the envelope carries no publisher field and block history
 * is pruned, so a message cannot be tied to a specific wallet. We infer from
 * write roles — meaning a wallet holding PUBLISHER on a device it does not
 * actually drive will still look live from that device's traffic. `source` is
 * returned so the UI can show which channel produced the verdict.
 */
export function useAgentLiveness(): {
    agents: AgentInfo[];
    liveness: Record<string, AgentLiveness>;
    isLoading: boolean;
} {
    const { agents, isLoading: isLoadingAgents } = useAgents();
    const { devices: deviceAddresses, isLoading: isLoadingDevices } = useAllDevices();

    // Device identity + channel addresses.
    const { data: deviceData } = useReadContracts({
        contracts: deviceAddresses.flatMap((address) => [
            { address, abi: abis.device, functionName: "deviceId", chainId: chain.id },
            {
                address,
                abi: abis.device,
                functionName: "getIncomingMessagesChannel",
                chainId: chain.id,
            },
            {
                address,
                abi: abis.device,
                functionName: "getOutgoingMessagesChannel",
                chainId: chain.id,
            },
        ]),
        query: {
            enabled: deviceAddresses.length > 0,
            refetchInterval: 30_000,
            placeholderData: keepPreviousData,
        },
    });

    const devices = useMemo<DeviceRef[]>(
        () =>
            deviceAddresses.map((address, i) => ({
                address,
                deviceId: deviceData?.[i * DEVICE_FIELDS]?.result as string | undefined,
                incoming: deviceData?.[i * DEVICE_FIELDS + 1]?.result as Address | undefined,
                outgoing: deviceData?.[i * DEVICE_FIELDS + 2]?.result as Address | undefined,
            })),
        [deviceAddresses, deviceData],
    );

    // Which owner wallets may write to which device, and in which direction.
    const owners = useMemo(
        () => agents.map((agent) => agent.owner).filter((o): o is Address => !!o),
        [agents],
    );

    const rolePairs = useMemo(
        () =>
            devices.flatMap((device) =>
                owners.flatMap((owner) => [
                    { device, owner, role: "PUBLISHER_ROLE" as const },
                    { device, owner, role: "MASTER_ROLE" as const },
                ]),
            ),
        [devices, owners],
    );

    const { data: roleData } = useReadContracts({
        contracts: rolePairs.map(({ device, owner, role }) => ({
            address: device.address,
            abi: abis.device,
            functionName: "hasRole",
            args: [DEVICE_ROLES[role] as Hex, owner],
            chainId: chain.id,
        })),
        query: {
            enabled: rolePairs.length > 0,
            refetchInterval: 60_000,
            placeholderData: keepPreviousData,
        },
    });

    // Freshest message on every device channel (both directions).
    const deviceChannels = useMemo(
        () =>
            devices.flatMap((device) => [
                { device, channel: device.outgoing, direction: "telemetry" as const },
                { device, channel: device.incoming, direction: "commands" as const },
            ]),
        [devices],
    );

    const { data: offsets } = useReadContracts({
        contracts: deviceChannels.map(({ channel }) => ({
            address: channel ?? zeroAddress,
            abi: abis.channel,
            functionName: "getLatestMessageOffset",
            chainId: chain.id,
        })),
        query: {
            enabled: deviceChannels.some((entry) => !!entry.channel),
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });
    const channelKinds = useChannelKinds(deviceChannels.map((entry) => entry.channel));

    const { data: messages } = useReadContracts({
        contracts: deviceChannels.map(({ channel }, i) => ({
            address: channel ?? zeroAddress,
            abi: abis.channel,
            functionName: "readMessages",
            args: [(offsets?.[i]?.result as bigint | undefined) ?? 0n, 1n],
            chainId: chain.id,
        })),
        query: {
            enabled: offsets?.some((entry) => entry?.result !== undefined) ?? false,
            refetchInterval: 15_000,
            placeholderData: keepPreviousData,
        },
    });

    const activity = useChannelActivityTimes(
        deviceChannels.map((entry, index) => ({
            address: entry.channel,
            latestOffset: offsets?.[index]?.result as bigint | undefined,
            enabled: channelKinds.kinds[index] === "encrypted",
        })),
    );

    const channelTimestamps = useMemo(
        () =>
            deviceChannels.map((_entry, i) => {
                if (channelKinds.kinds[i] === "encrypted") return activity.timestamps[i];
                try {
                    const raw = messages?.[i]?.result as [Hex[], bigint[]] | undefined;
                    if (raw?.[0]?.[0]) return decode(hexToBytes(raw[0][0])).ts;
                } catch {
                    // non-envelope payload — no usable timestamp
                }
                return undefined;
            }),
        [deviceChannels, messages, channelKinds.kinds, activity.timestamps],
    );

    const liveness = useMemo(() => {
        const result: Record<string, AgentLiveness> = {};

        for (const agent of agents) {
            const candidates: { ts: number; source: string }[] = [];

            // The agent's own audit channel.
            if (agent.lastMessageTs !== undefined) {
                candidates.push({ ts: agent.lastMessageTs, source: "agent log" });
            }

            // Device channels this agent's owner is authorised to write to.
            if (agent.owner) {
                deviceChannels.forEach((entry, i) => {
                    const ts = channelTimestamps[i];
                    if (ts === undefined || !entry.channel) return;

                    const wantedRole =
                        entry.direction === "telemetry" ? "PUBLISHER_ROLE" : "MASTER_ROLE";
                    const pairIndex = rolePairs.findIndex(
                        (pair) =>
                            pair.device.address === entry.device.address &&
                            pair.owner.toLowerCase() === agent.owner?.toLowerCase() &&
                            pair.role === wantedRole,
                    );
                    if (pairIndex === -1 || roleData?.[pairIndex]?.result !== true) return;

                    const name = entry.device.deviceId ?? "device";
                    candidates.push({ ts, source: `${name} ${entry.direction}` });
                });
            }

            if (candidates.length === 0) {
                result[agent.address] = {};
                continue;
            }

            const best = candidates.reduce((a, b) => (b.ts > a.ts ? b : a));
            result[agent.address] = { lastActivityTs: best.ts, source: best.source };
        }

        return result;
    }, [agents, deviceChannels, channelTimestamps, rolePairs, roleData]);

    return {
        agents,
        liveness,
        isLoading: isLoadingAgents || isLoadingDevices,
    };
}
