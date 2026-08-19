import {
    discloseMessages,
    MAX_DISCLOSE_BATCH,
    resolveChannelWithConfig,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { presentDiscloseResult } from "./result.js";
import { requireSafeInteger } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function discloseTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_disclose",
        label: "SmartClaws Disclose",
        description:
            "Open encrypted channel messages: signs requestMessages, waits for the CTX, then decrypts. Requires a local viewing key, reader authorization, and a registered public key. Count must be 1–10; larger ranges are not split into several transactions. `side` picks which half of a device/agent pair to disclose — `outgoing` (default) or `incoming`. On encrypted channels this is how you get plaintext; `smartclaws_read` returns labelled ciphertext.",
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
            throwIfAborted(context.signal);
            requireSafeInteger(params.fromOffset, "fromOffset", { min: 0 });
            const count = params.count ?? 1;
            if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DISCLOSE_BATCH) {
                throw new SmartClawsError(
                    "READ_BATCH_LIMIT",
                    `Disclosure count must be between 1 and ${MAX_DISCLOSE_BATCH}; larger ranges are not split into multiple paid transactions.`,
                    { count, max: MAX_DISCLOSE_BATCH },
                );
            }

            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            const { channelAddress, device, agent, side } = await resolveChannelWithConfig(
                {
                    device: params.device,
                    agent: params.agent,
                    channel: params.channel,
                    side: params.side,
                },
                cfg,
                wallet,
                home,
            );
            throwIfAborted(context.signal);
            const result = await discloseMessages(
                { channelAddress, fromOffset: params.fromOffset, count },
                cfg,
                wallet,
            );
            throwIfAborted(context.signal);
            return {
                ...presentDiscloseResult(result),
                device: device ?? null,
                agent: agent ?? null,
                side,
            };
        },
    });
}
