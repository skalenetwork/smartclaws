import { attachHomeEntities, homeFingerprint, loadConfig, localSaveFailed } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

function presentAttachedGroup(
    group: Awaited<ReturnType<typeof attachHomeEntities>>["group"],
): Record<string, unknown> | null {
    if (!group) return null;
    return {
        name: group.name,
        address: group.groupAddress,
        owner: group.owner ?? null,
        skills: group.skills ?? "",
        deviceCount: group.deviceCount ?? null,
    };
}

function presentAttachedAgent(
    agent: Awaited<ReturnType<typeof attachHomeEntities>>["agent"],
): Record<string, unknown> | null {
    if (!agent) return null;
    return {
        name: agent.name,
        address: agent.agentContract,
        owner: agent.owner ?? null,
        incomingChannel: agent.incomingChannel,
        outgoingChannel: agent.outgoingChannel,
        encrypted: agent.encrypted === true,
    };
}

function presentAttachedDevice(
    device: NonNullable<Awaited<ReturnType<typeof attachHomeEntities>>["devices"]>[number],
) {
    return {
        name: device.name,
        address: device.deviceContract,
        group: device.groupAddress,
        incomingChannel: device.incomingChannel,
        outgoingChannel: device.outgoingChannel,
        encrypted: device.encrypted === true,
    };
}

export function attachTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_attach",
        label: "SmartClaws Attach",
        description:
            "Update local group/device/agent attachments without creating contracts. Omitted fields stay unchanged; explicit null detaches group or agent; supplying devices replaces the attached-device set. Requires expectedFingerprint. Recovers a confirmed registration whose local save failed. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            expectedFingerprint: Type.String({
                description: "HOME fingerprint from smartclaws_setup_status.",
            }),
            group: Type.Optional(
                Type.Union([Type.String(), Type.Null()], {
                    description: "Group address or name, or null to detach.",
                }),
            ),
            agent: Type.Optional(
                Type.Union([Type.String(), Type.Null()], {
                    description: "Agent address or name, or null to detach.",
                }),
            ),
            devices: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Replacement set of device addresses or names.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const result = await attachHomeEntities({
                homeDir: resolvedHome(config),
                expectedFingerprint: params.expectedFingerprint,
                group: params.group,
                agent: params.agent,
                devices: params.devices,
            });
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "attached",
                group: presentAttachedGroup(result.group),
                agent: presentAttachedAgent(result.agent),
                devices: result.devices.map(presentAttachedDevice),
                fingerprint: result.fingerprint,
            });
        },
    });
}

/** After a confirmed registration, attach locally. Never retry the chain write if this fails. */
export async function attachAfterConfirmedRegistration(input: {
    homeDir: string;
    kind: "group" | "device" | "agent";
    address: string;
    txHash: `0x${string}`;
}): Promise<{ fingerprint: string; attached: true }> {
    try {
        const config = loadConfig(input.homeDir);
        if (!config) {
            throw localSaveFailed(
                input.txHash,
                { kind: input.kind, address: input.address },
                "HOME config missing after registration",
            );
        }
        const result = await attachHomeEntities({
            homeDir: input.homeDir,
            expectedFingerprint: homeFingerprint(input.homeDir),
            group: input.kind === "group" ? input.address : undefined,
            agent: input.kind === "agent" ? input.address : undefined,
            devices:
                input.kind === "device"
                    ? [...new Set([...config.attachedDeviceAddresses, input.address])]
                    : undefined,
        });
        return { fingerprint: result.fingerprint, attached: true };
    } catch (error) {
        throw localSaveFailed(input.txHash, { kind: input.kind, address: input.address }, error);
    }
}
