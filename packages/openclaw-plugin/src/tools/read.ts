import { readMessages, resolveChannel } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function readTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_read",
        label: "SmartClaws Read",
        description:
            "Read recent decoded messages from a device's outgoing channel or a direct channel address. Read-only; no wallet required.",
        parameters: Type.Object({
            device: Type.Optional(Type.String({ description: "Local device name." })),
            channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
            limit: Type.Optional(
                Type.Number({ description: "Max messages to read (default 10)." }),
            ),
            offset: Type.Optional(Type.Number({ description: "Start reading at this offset." })),
        }),
        execute: async (params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const { channelAddress, device } = resolveChannel(
                { device: params.device, channel: params.channel },
                config.smartclawsHome,
            );
            const result = await readMessages(
                { channelAddress, limit: params.limit, offset: params.offset },
                cfg,
            );
            return { ...result, device: device ?? null };
        },
    });
}
