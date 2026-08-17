import { registerAgentWithResult } from "@smartclaws/sdk";
import { Type } from "typebox";
import {
    maxChannelCapacityBytes,
    requireWallet,
    resolveConfig,
    resolvedHome,
} from "../plugin-config.js";
import { attachAfterConfirmedRegistration } from "./attach.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { parseChannelCapacity, requireNonEmptyName } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function registerAgentTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_register_agent",
        label: "SmartClaws Register Agent",
        description:
            "Register an agent on-chain with an explicit stable name. Capacity is a decimal string. Waits for a successful receipt. If the current mode needs more identities before attachment, returns confirmed with attachmentIssue and recommends smartclaws_attach. If local persistence fails after confirmation, recover with smartclaws_attach — do not retry registration. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            name: Type.String({ description: "Required stable agent name." }),
            metadata: Type.Optional(Type.String({ description: "Optional agent metadata." })),
            capacityBytes: Type.Optional(
                Type.String({
                    description: "Channel capacity as a decimal string (default 1048576).",
                }),
            ),
            encrypted: Type.Optional(Type.Boolean({ description: "Register an encrypted agent." })),
            attach: Type.Optional(
                Type.Boolean({
                    description: "Attach the agent locally after confirmation (default true).",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const name = requireNonEmptyName(params.name);
            const capacity = parseChannelCapacity(
                params.capacityBytes,
                maxChannelCapacityBytes(config),
            );
            const { entity, txHash } = await registerAgentWithResult(
                cfg,
                wallet,
                name,
                params.metadata ?? "",
                capacity,
                home,
                { encrypted: Boolean(params.encrypted) },
            );
            throwIfAborted(context.signal);
            const shouldAttach = params.attach !== false;
            const attachment = shouldAttach
                ? await attachAfterConfirmedRegistration({
                      homeDir: home,
                      kind: "agent",
                      address: entity.agentContract,
                      txHash,
                  })
                : {
                      attached: false as const,
                      fingerprint: undefined,
                      attachmentIssue: undefined,
                  };
            return jsonCompatible({
                status: "confirmed",
                txHash,
                agent: {
                    name: entity.name,
                    address: entity.agentContract,
                    owner: entity.owner ?? null,
                    incomingChannel: entity.incomingChannel,
                    outgoingChannel: entity.outgoingChannel,
                    encrypted: entity.encrypted === true,
                },
                attached: attachment.attached,
                attachmentIssue: attachment.attachmentIssue ?? null,
                fingerprint: attachment.fingerprint ?? null,
            });
        },
    });
}
