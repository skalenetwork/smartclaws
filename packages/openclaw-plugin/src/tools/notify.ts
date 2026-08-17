import { publishAgentInbound, resolveAgent } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
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
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            const options = { wait: params.wait ?? true };
            const agent = await resolveAgent(params.agent, cfg, wallet, home);
            throwIfAborted(context.signal);
            return presentPublishResult(
                await publishAgentInbound(
                    {
                        agentAddress: agent.agentContract as `0x${string}`,
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
