import { listAgentReaders, listDeviceReaders, resolveAgent, resolveDevice } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { ChannelSideSchema } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function readerListTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_reader_list",
        label: "SmartClaws Reader List",
        description:
            "List reader addresses and channel metadata for a device or agent channel. Read-only. Reader ACLs are not AccessControl roles. Plain channels have no reader list — everything on them is public.",
        parameters: Type.Object({
            kind: Type.Union([Type.Literal("device"), Type.Literal("agent")], {
                description: "Entity kind.",
            }),
            target: Type.String({ description: "Address or local name." }),
            side: ChannelSideSchema,
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const home = resolvedHome(config);
            const entity =
                params.kind === "device"
                    ? await resolveDevice(params.target, cfg, undefined, home)
                    : await resolveAgent(params.target, cfg, undefined, home);
            const channel =
                params.side === "incoming" ? entity.incomingChannel : entity.outgoingChannel;
            const readers =
                params.kind === "device"
                    ? await listDeviceReaders(cfg, params.target, params.side, home)
                    : await listAgentReaders(cfg, params.target, params.side, home);
            throwIfAborted(context.signal);
            return jsonCompatible({
                kind: params.kind,
                target: params.target,
                side: params.side,
                channel,
                encrypted: entity.encrypted === true,
                readers,
            });
        },
    });
}
