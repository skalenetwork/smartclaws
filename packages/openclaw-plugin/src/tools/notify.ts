import { loadAgent, publishAgentInbound, SmartClawsError } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function notifyTool(tool: SmartClawsToolFactory) {
  return tool({
    name: "smartclaws_notify",
    label: "SmartClaws Notify",
    description:
      "Send a message to another agent's incoming channel (requires SENDER_ROLE on that agent). Signs a transaction and returns its hash.",
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
    }),
    execute: async (params, config, context) => {
      context.signal?.throwIfAborted();
      const cfg = resolveConfig(config);
      const wallet = requireWallet(config.smartclawsHome);

      const agent = loadAgent(params.agent, config.smartclawsHome);
      const agentAddress = (agent?.agentContract ?? params.agent) as `0x${string}`;
      if (!agentAddress.startsWith("0x")) {
        throw new SmartClawsError("ENTITY_NOT_FOUND", `Agent '${params.agent}' not found.`, {
          agent: params.agent,
        });
      }

      return await publishAgentInbound(
        {
          agentAddress,
          topic: params.topic,
          payload: params.payload,
          from: params.from ?? "controller",
        },
        cfg,
        wallet,
      );
    },
  });
}
