import { loadAgent, publishAgentInbound, SmartClawsError } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import { presentPublishResult } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function notifyTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_notify",
        label: "SmartClaws Notify",
        description:
            "Send a message to another agent's incoming channel (requires SENDER_ROLE on that agent). Auto-detects plain vs encrypted. Encrypted notifies wait for CTX confirmation by default and return PublishState, callback deposit, and CTX hashes. `scheduled` means the origin tx was accepted, not that the message is stored — never treat it as published.",
        optional: true,
        parameters: Type.Object({
            agent: Type.String({ description: "Target agent name or contract address (0x...)." }),
            topic: Type.String({ description: "Message topic, e.g. task.assign." }),
            payload: Type.Record(Type.String(), Type.Unknown(), {
                description: "JSON payload object.",
            }),
            from: Type.Optional(
                Type.String({
                    description: "Envelope `dev` identity of the sender (default: controller).",
                }),
            ),
            wait: Type.Optional(
                Type.Boolean({
                    description:
                        "Wait for CTX confirmation on encrypted notifies (default true). A timeout remains status=scheduled and is never rewritten as published.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const options = { wait: params.wait ?? true };

            const agent = loadAgent(params.agent, config.smartclawsHome);
            const agentAddress = (agent?.agentContract ?? params.agent) as `0x${string}`;
            if (!agentAddress.startsWith("0x")) {
                throw new SmartClawsError(
                    "ENTITY_NOT_FOUND",
                    `Agent '${params.agent}' not found.`,
                    {
                        agent: params.agent,
                    },
                );
            }

            return presentPublishResult(
                await publishAgentInbound(
                    {
                        agentAddress,
                        topic: params.topic,
                        payload: params.payload,
                        from: params.from ?? "controller",
                    },
                    cfg,
                    wallet,
                    options,
                ),
            );
        },
    });
}
