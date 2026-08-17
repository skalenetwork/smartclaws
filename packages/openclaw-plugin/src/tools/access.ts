import {
    getAgentReaderStatus,
    getDeviceReaderStatus,
    listAgents,
    listDevices,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
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
 * It used to run inside `smartclaws_wallet_info`, which meant every call to "what is my
 * address and balance" also walked every locally known entity. Splitting it keeps the cheap
 * question cheap and lets this one name a single entity when that is all the caller wants.
 */
export function accessTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_access_check",
        label: "SmartClaws Access Check",
        description:
            "Report whether the configured wallet can read a device or agent's incoming and outgoing channels. Plain channels are readable by anyone; encrypted channels depend on the channel's reader list. Omit both arguments to check every locally known entity.",
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Device address or local name" })),
            agent: Type.Optional(Type.String({ description: "Agent address or local name" })),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const home = config.smartclawsHome;

            if (params.device && params.agent) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "Provide `device` or `agent`, not both.",
                    { device: params.device, agent: params.agent },
                );
            }

            const devices = listDevices(home);
            const agents = listAgents(home);

            const wanted = {
                devices: params.agent
                    ? []
                    : devices.filter(matches(params.device, "deviceContract")),
                agents: params.device ? [] : agents.filter(matches(params.agent, "agentContract")),
            };
            if (params.device && wanted.devices.length === 0) {
                throw new SmartClawsError(
                    "DEVICE_NOT_FOUND",
                    `Device '${params.device}' not found.`,
                    {
                        available: devices.map((d) => d.name),
                    },
                );
            }
            if (params.agent && wanted.agents.length === 0) {
                throw new SmartClawsError(
                    "ENTITY_NOT_FOUND",
                    `Agent '${params.agent}' not found.`,
                    {
                        available: agents.map((a) => a.name),
                    },
                );
            }

            // Entities are independent of each other, so there is no reason to queue them.
            const entries = await Promise.all([
                ...wanted.devices.map(async (device): Promise<AccessEntry> => {
                    const status = await getDeviceReaderStatus(
                        cfg,
                        device.deviceContract,
                        wallet.address,
                        home,
                    );
                    return {
                        kind: "device",
                        name: device.name,
                        encrypted: device.encrypted === true,
                        incomingChannel: device.incomingChannel,
                        outgoingChannel: device.outgoingChannel,
                        canReadIncoming: status.isIncomingReader,
                        canReadOutgoing: status.isOutgoingReader,
                    };
                }),
                ...wanted.agents.map(async (agent): Promise<AccessEntry> => {
                    const status = await getAgentReaderStatus(
                        cfg,
                        agent.agentContract,
                        wallet.address,
                        home,
                    );
                    return {
                        kind: "agent",
                        name: agent.name,
                        encrypted: agent.encrypted === true,
                        incomingChannel: agent.incomingChannel,
                        outgoingChannel: agent.outgoingChannel,
                        canReadIncoming: status.isIncomingReader,
                        canReadOutgoing: status.isOutgoingReader,
                    };
                }),
            ]);

            return { account: wallet.address, entries };
        },
    });
}

function matches<K extends string>(query: string | undefined, addressKey: K) {
    return (record: { name: string } & Record<K, string>): boolean => {
        if (!query) return true;
        return record.name === query || record[addressKey].toLowerCase() === query.toLowerCase();
    };
}
