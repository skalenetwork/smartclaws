import {
    publishAgentOutbound,
    publishChannelMessage,
    publishDeviceCommand,
    publishDeviceTelemetry,
    resolveAgent,
    resolveChannel,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import { presentPublishResult } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function publishTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_publish",
        label: "SmartClaws Publish",
        description:
            "Publish an envelope to a device's outgoing channel, your agent's outgoing channel (e.g. a decision log), or a direct channel address. Auto-detects plain vs encrypted. Encrypted publishes wait for CTX confirmation by default and return PublishState (`published` | `scheduled` | `origin-reverted` | `ctx-reverted`), callback deposit, and CTX hashes. `scheduled` means the origin tx was accepted, not that the message is stored — never treat it as published.",
        optional: true,
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Local device name to publish as." })),
            deviceChannel: Type.Optional(
                Type.Union([Type.Literal("telemetry"), Type.Literal("command")], {
                    description:
                        "When `device` is used: `telemetry` publishes to outgoing telemetry (default); `command` publishes to incoming commands.",
                }),
            ),
            agent: Type.Optional(
                Type.String({
                    description:
                        "Local agent name/address; publishes to the agent's outgoing channel.",
                }),
            ),
            channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
            topic: Type.String({ description: "Message topic, e.g. telemetry.pm." }),
            payload: Type.Record(Type.String(), Type.Unknown(), {
                description: "JSON payload object.",
            }),
            from: Type.Optional(
                Type.String({
                    description:
                        "Envelope `dev` identity when using `channel` (default: controller).",
                }),
            ),
            wait: Type.Optional(
                Type.Boolean({
                    description:
                        "Wait for CTX confirmation on encrypted publishes (default true). A timeout remains status=scheduled and is never rewritten as published.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const options = { wait: params.wait ?? true };

            if (params.agent) {
                if (params.device || params.channel) {
                    throw new SmartClawsError(
                        "INVALID_TARGET",
                        "Provide exactly one of `device`, `agent`, or `channel`.",
                    );
                }
                const agent = await resolveAgent(params.agent, cfg, wallet, config.smartclawsHome);
                return presentPublishResult(
                    await publishAgentOutbound(
                        {
                            agentAddress: agent.agentContract as `0x${string}`,
                            topic: params.topic,
                            payload: params.payload,
                            from: params.from ?? agent.name,
                        },
                        cfg,
                        wallet,
                        options,
                    ),
                );
            }

            const { channelAddress, device, deviceAddress } = resolveChannel(
                { device: params.device, channel: params.channel },
                config.smartclawsHome,
            );
            if (params.deviceChannel && !device) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "`deviceChannel` is only valid with `device` targets.",
                    { deviceChannel: params.deviceChannel },
                );
            }
            if (device) {
                if (!deviceAddress) {
                    throw new SmartClawsError(
                        "DEVICE_NOT_FOUND",
                        `Device '${params.device}' is missing its contract address.`,
                        { device: params.device },
                    );
                }
                if (params.deviceChannel === "command") {
                    return presentPublishResult(
                        await publishDeviceCommand(
                            {
                                deviceAddress,
                                topic: params.topic,
                                payload: params.payload,
                                from: params.from ?? device,
                            },
                            cfg,
                            wallet,
                            options,
                        ),
                    );
                }
                return presentPublishResult(
                    await publishDeviceTelemetry(
                        {
                            deviceAddress,
                            topic: params.topic,
                            payload: params.payload,
                            from: device,
                        },
                        cfg,
                        wallet,
                        options,
                    ),
                );
            }

            const from = params.from ?? "controller";
            return presentPublishResult(
                await publishChannelMessage(
                    { channelAddress, topic: params.topic, payload: params.payload, from },
                    cfg,
                    wallet,
                    options,
                ),
            );
        },
    });
}
