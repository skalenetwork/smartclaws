import {
    discloseMessages,
    MAX_DISCLOSE_BATCH,
    resolveChannel,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import { presentDiscloseResult } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function discloseTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_disclose",
        label: "SmartClaws Disclose",
        description:
            "Paid two-phase disclosure of encrypted channel messages: signs requestMessages, waits for the CTX, then decrypts. Requires reader authorization and a registered public key, checked before spending. Count must be 1–10; larger ranges are not split into several paid transactions. `side` picks which half of a device/agent pair to disclose — `outgoing` (default) or `incoming`. Use smartclaws_read for free ciphertext inspection.",
        optional: true,
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Local device name." })),
            agent: Type.Optional(Type.String({ description: "Local agent name or address." })),
            channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
            side: Type.Optional(
                Type.Union([Type.Literal("outgoing"), Type.Literal("incoming")], {
                    description:
                        "Which channel of a device/agent to disclose: `outgoing` (default) or `incoming`. Not valid with `channel`.",
                }),
            ),
            fromOffset: Type.Number({
                description: "First stored offset to disclose (inclusive).",
            }),
            count: Type.Optional(
                Type.Number({
                    description: `Number of messages to disclose (1–${MAX_DISCLOSE_BATCH}, default 1). Larger ranges are not split.`,
                }),
            ),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const count = params.count ?? 1;
            if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DISCLOSE_BATCH) {
                throw new SmartClawsError(
                    "READ_BATCH_LIMIT",
                    `Disclosure count must be between 1 and ${MAX_DISCLOSE_BATCH}; larger ranges are not split into multiple paid transactions.`,
                    { count, max: MAX_DISCLOSE_BATCH },
                );
            }

            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const { channelAddress, device, agent, side } = resolveChannel(
                {
                    device: params.device,
                    agent: params.agent,
                    channel: params.channel,
                    side: params.side,
                },
                config.smartclawsHome,
            );
            const result = await discloseMessages(
                { channelAddress, fromOffset: params.fromOffset, count },
                cfg,
                wallet,
            );
            return {
                ...presentDiscloseResult(result),
                device: device ?? null,
                agent: agent ?? null,
                side,
            };
        },
    });
}
