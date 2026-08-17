import { readMessages, resolveChannel } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function readTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_read",
        label: "SmartClaws Read",
        description:
            "Read recent messages from a device or agent channel, or a direct channel address. Free, wallet-free, and never optional. `side` picks which half of the entity's pair: `outgoing` (default) is what the entity published; `incoming` is what was sent to it (device commands, agent notifications). Encrypted channels return labelled ciphertext (`encrypted`, `ciphertextBytes`, raw hex) — that is a successful read, not a decode error. Paid decryption is a separate tool (`smartclaws_disclose`).",
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Local device name." })),
            agent: Type.Optional(Type.String({ description: "Local agent name or address." })),
            channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
            side: Type.Optional(
                Type.Union([Type.Literal("outgoing"), Type.Literal("incoming")], {
                    description:
                        "Which channel of a device/agent to read: `outgoing` (default) or `incoming`. Not valid with `channel`.",
                }),
            ),
            limit: Type.Optional(
                Type.Number({ description: "Max messages to read (default 10)." }),
            ),
            offset: Type.Optional(Type.Number({ description: "Start reading at this offset." })),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const { channelAddress, device, agent, side } = resolveChannel(
                {
                    device: params.device,
                    agent: params.agent,
                    channel: params.channel,
                    side: params.side,
                },
                config.smartclawsHome,
            );
            const result = await readMessages(
                { channelAddress, limit: params.limit, offset: params.offset },
                cfg,
            );
            return { ...result, device: device ?? null, agent: agent ?? null, side };
        },
    });
}
