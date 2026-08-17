import { listAgents, listDevices, listGroups } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

function presentGroup(group: ReturnType<typeof listGroups>[number]) {
    return {
        name: group.name,
        address: group.groupAddress,
        owner: group.owner ?? null,
        skills: group.skills ?? "",
        deviceCount: group.deviceCount ?? null,
        capabilities: group.capabilities ?? null,
    };
}

function presentDevice(device: ReturnType<typeof listDevices>[number]) {
    return {
        name: device.name,
        address: device.deviceContract,
        group: device.groupAddress,
        incomingChannel: device.incomingChannel,
        outgoingChannel: device.outgoingChannel,
        encrypted: device.encrypted === true,
        owner: null,
        capabilities: device.capabilities ?? null,
    };
}

function presentAgent(agent: ReturnType<typeof listAgents>[number]) {
    return {
        name: agent.name,
        address: agent.agentContract,
        owner: agent.owner ?? null,
        incomingChannel: agent.incomingChannel,
        outgoingChannel: agent.outgoingChannel,
        encrypted: agent.encrypted === true,
        capabilities: agent.capabilities ?? null,
    };
}

export function listLocalTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_list_local",
        label: "SmartClaws List Local",
        description:
            "List locally cached groups, devices, and/or agents: addresses, channels, encryption kind, owner, and capabilities. Never returns filesystem paths.",
        parameters: Type.Object({
            kind: Type.Optional(
                Type.Union(
                    [
                        Type.Literal("all"),
                        Type.Literal("group"),
                        Type.Literal("device"),
                        Type.Literal("agent"),
                    ],
                    { description: "Which local records to list (default all)." },
                ),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const kind = params.kind ?? "all";
            const groups =
                kind === "all" || kind === "group" ? listGroups(home).map(presentGroup) : [];
            const devices =
                kind === "all" || kind === "device" ? listDevices(home).map(presentDevice) : [];
            const agents =
                kind === "all" || kind === "agent" ? listAgents(home).map(presentAgent) : [];
            throwIfAborted(context.signal);
            return jsonCompatible({ groups, devices, agents });
        },
    });
}
