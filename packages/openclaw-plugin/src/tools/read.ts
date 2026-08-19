import { readMessages, resolveChannelWithConfig, SmartClawsError } from "@smartclaws/sdk";
import { Type } from "typebox";
import {
    HARD_MAX_READ_MESSAGES,
    readMessageLimit,
    resolveConfig,
    resolvedHome,
} from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { ChannelSideSchema, requireSafeInteger } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function readTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_read",
        label: "SmartClaws Read",
        description:
            "Read recent messages from a device or agent channel, or a direct channel address. No wallet required. `side` picks which half of the entity's pair: `outgoing` (default) is what the entity published; `incoming` is what was sent to it (device commands, agent notifications). Encrypted channels return labelled ciphertext (`encrypted`, `ciphertextBytes`, raw hex) — that is a successful read, not a decode error. Empty channels still report `encrypted` when the channel kind is known. To get plaintext on an encrypted channel, use `smartclaws_disclose`.",
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Local device name." })),
            agent: Type.Optional(Type.String({ description: "Local agent name or address." })),
            channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
            side: Type.Optional(ChannelSideSchema),
            limit: Type.Optional(
                Type.Number({
                    description: `Max messages to read (default 10, hard maximum ${HARD_MAX_READ_MESSAGES}).`,
                }),
            ),
            offset: Type.Optional(Type.Number({ description: "Start reading at this offset." })),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            requireSafeInteger(params.limit, "limit", { min: 1, max: HARD_MAX_READ_MESSAGES });
            requireSafeInteger(params.offset, "offset", { min: 0 });
            if (params.limit !== undefined && params.limit > HARD_MAX_READ_MESSAGES) {
                throw new SmartClawsError(
                    "READ_BATCH_LIMIT",
                    `Read limit cannot exceed ${HARD_MAX_READ_MESSAGES}.`,
                    { limit: params.limit, max: HARD_MAX_READ_MESSAGES },
                );
            }
            const cfg = resolveConfig(config);
            const home = resolvedHome(config);
            const { channelAddress, device, agent, side } = await resolveChannelWithConfig(
                {
                    device: params.device,
                    agent: params.agent,
                    channel: params.channel,
                    side: params.side,
                },
                cfg,
                undefined,
                home,
            );
            throwIfAborted(context.signal);
            const result = await readMessages(
                {
                    channelAddress,
                    limit: readMessageLimit(config, params.limit),
                    offset: params.offset,
                },
                cfg,
            );
            throwIfAborted(context.signal);
            return jsonCompatible({
                ...result,
                device: device ?? null,
                agent: agent ?? null,
                side,
            });
        },
    });
}
