import { publishMessage, resolveChannel } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function publishTool(tool: SmartClawsToolFactory) {
  return tool({
    name: "smartclaws_publish",
    label: "SmartClaws Publish",
    description:
      "Publish an envelope to a device's outgoing channel or a direct channel address. Signs a transaction and returns its hash.",
    optional: true,
    parameters: Type.Object({
      device: Type.Optional(Type.String({ description: "Local device name to publish as." })),
      channel: Type.Optional(Type.String({ description: "Direct channel address (0x...)." })),
      topic: Type.String({ description: "Message topic, e.g. telemetry.pm." }),
      payload: Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON payload object.",
      }),
      from: Type.Optional(
        Type.String({
          description: "Envelope `dev` identity when using `channel` (default: controller).",
        }),
      ),
    }),
    execute: async (params, config, context) => {
      context.signal?.throwIfAborted();
      const cfg = resolveConfig(config);
      const wallet = requireWallet(config.smartclawsHome);
      const { channelAddress, device } = resolveChannel(
        { device: params.device, channel: params.channel },
        config.smartclawsHome,
      );
      const from = device ?? params.from ?? "controller";
      return await publishMessage(
        { channelAddress, topic: params.topic, payload: params.payload, from },
        cfg,
        wallet,
      );
    },
  });
}
