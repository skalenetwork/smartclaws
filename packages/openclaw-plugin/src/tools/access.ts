import {
    getAgentReaderStatus,
    getDeviceReaderStatus,
    listAgents,
    listDevices,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import {
    ACCESS_CONCURRENCY,
    accessPageLimit,
    requireWallet,
    resolveConfig,
    resolvedHome,
} from "../plugin-config.js";
import { mapPool, throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { requireSafeInteger } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

interface AccessEntry {
    kind: "device" | "agent";
    name: string;
    encrypted: boolean;
    incomingChannel: string;
    outgoingChannel: string;
    canReadIncoming: boolean;
    canReadOutgoing: boolean;
}

/**
 * Access is a per-entity question, so it lives apart from wallet identity.
 *
 * Untargeted listing is paginated with bounded concurrency so it cannot fan out
 * unbounded RPC. Targeted lookup of one device or agent stays a single pair of reads.
 */
export function accessTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_access_check",
        label: "SmartClaws Access Check",
        description:
            "Report whether the configured wallet can read a device or agent's incoming and outgoing channels. Plain channels are readable by anyone; encrypted channels depend on the channel's reader list. Omit device/agent to page through locally known entities.",
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Device address or local name" })),
            agent: Type.Optional(Type.String({ description: "Agent address or local name" })),
            offset: Type.Optional(
                Type.Number({
                    description: "Page offset when listing all known entities (default 0).",
                }),
            ),
            limit: Type.Optional(
                Type.Number({
                    description:
                        "Page size when listing all known entities (small default, hard-capped).",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);

            if (params.device && params.agent) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "Provide `device` or `agent`, not both.",
                    { device: params.device, agent: params.agent },
                );
            }

            const devices = listDevices(home);
            const agents = listAgents(home);
            const wantedDevices = params.agent
                ? []
                : devices.filter(matches(params.device, "deviceContract"));
            const wantedAgents = params.device
                ? []
                : agents.filter(matches(params.agent, "agentContract"));

            if (params.device && wantedDevices.length === 0) {
                throw new SmartClawsError(
                    "DEVICE_NOT_FOUND",
                    `Device '${params.device}' not found.`,
                    {
                        available: devices.map((device) => device.name),
                    },
                );
            }
            if (params.agent && wantedAgents.length === 0) {
                throw new SmartClawsError(
                    "ENTITY_NOT_FOUND",
                    `Agent '${params.agent}' not found.`,
                    {
                        available: agents.map((agent) => agent.name),
                    },
                );
            }

            const catalog: Array<
                | { kind: "device"; record: (typeof devices)[number] }
                | { kind: "agent"; record: (typeof agents)[number] }
            > = [
                ...wantedDevices.map((record) => ({ kind: "device" as const, record })),
                ...wantedAgents.map((record) => ({ kind: "agent" as const, record })),
            ];

            const targeted = Boolean(params.device || params.agent);
            const offset = targeted
                ? 0
                : (requireSafeInteger(params.offset, "offset", { min: 0 }) ?? 0);
            const limit = targeted ? catalog.length || 1 : accessPageLimit(config, params.limit);
            const total = catalog.length;
            const page = catalog.slice(offset, offset + limit);

            const entries = await mapPool(
                page,
                ACCESS_CONCURRENCY,
                async (item): Promise<AccessEntry> => {
                    if (item.kind === "device") {
                        const status = await getDeviceReaderStatus(
                            cfg,
                            item.record.deviceContract,
                            wallet.address,
                            home,
                        );
                        return {
                            kind: "device",
                            name: item.record.name,
                            encrypted: item.record.encrypted === true,
                            incomingChannel: item.record.incomingChannel,
                            outgoingChannel: item.record.outgoingChannel,
                            canReadIncoming: status.isIncomingReader,
                            canReadOutgoing: status.isOutgoingReader,
                        };
                    }
                    const status = await getAgentReaderStatus(
                        cfg,
                        item.record.agentContract,
                        wallet.address,
                        home,
                    );
                    return {
                        kind: "agent",
                        name: item.record.name,
                        encrypted: item.record.encrypted === true,
                        incomingChannel: item.record.incomingChannel,
                        outgoingChannel: item.record.outgoingChannel,
                        canReadIncoming: status.isIncomingReader,
                        canReadOutgoing: status.isOutgoingReader,
                    };
                },
                context.signal,
            );

            throwIfAborted(context.signal);
            const next = offset + entries.length;
            return jsonCompatible({
                account: wallet.address,
                total,
                offset,
                limit,
                nextOffset: next < total ? next : null,
                entries,
            });
        },
    });
}

function matches<K extends string>(query: string | undefined, addressKey: K) {
    return (record: { name: string } & Record<K, string>): boolean => {
        if (!query) return true;
        return record.name === query || record[addressKey].toLowerCase() === query.toLowerCase();
    };
}
