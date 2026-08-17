import {
    assertNotSelfReaderRevocation,
    grantAgentReader,
    grantDeviceReader,
    listAgentReaders,
    listDeviceReaders,
    resolveAgent,
    resolveDevice,
    revokeAgentReader,
    revokeDeviceReader,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { getAddress } from "viem";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { AddressSchema, ChannelSideSchema } from "./schemas.js";
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

const mutatingReaderParams = {
    kind: Type.Union([Type.Literal("device"), Type.Literal("agent")]),
    target: Type.String({ description: "Entity address or local name." }),
    side: ChannelSideSchema,
    account: AddressSchema,
};

export function readerGrantTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_reader_grant",
        label: "SmartClaws Reader Grant",
        description:
            "Grant reader ACL access on an encrypted device or agent channel. Plain channels have no reader list. This is not an AccessControl role. No automatic retries.",
        optional: true,
        parameters: Type.Object(mutatingReaderParams),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            const account = getAddress(params.account);
            const entity =
                params.kind === "device"
                    ? await resolveDevice(params.target, cfg, wallet, home)
                    : await resolveAgent(params.target, cfg, wallet, home);
            const channel =
                params.side === "incoming" ? entity.incomingChannel : entity.outgoingChannel;
            const result =
                params.kind === "device"
                    ? await grantDeviceReader(
                          cfg,
                          wallet,
                          params.target,
                          params.side,
                          account,
                          home,
                      )
                    : await grantAgentReader(
                          cfg,
                          wallet,
                          params.target,
                          params.side,
                          account,
                          home,
                      );
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                kind: params.kind,
                target: params.target,
                side: params.side,
                channel,
                account: result.reader,
            });
        },
    });
}

export function readerRevokeTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_reader_revoke",
        label: "SmartClaws Reader Revoke",
        description:
            "Remove reader ACL access on an encrypted device or agent channel. Refuses to remove the active wallet's own reader access unless allowSelfRevocation is true. This is not an AccessControl role. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            ...mutatingReaderParams,
            allowSelfRevocation: Type.Optional(
                Type.Boolean({
                    description: "Required to revoke the active wallet's own reader access.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            const account = getAddress(params.account);
            assertNotSelfReaderRevocation({
                walletAddress: wallet.address,
                account,
                allowSelfRevocation: params.allowSelfRevocation,
            });
            const entity =
                params.kind === "device"
                    ? await resolveDevice(params.target, cfg, wallet, home)
                    : await resolveAgent(params.target, cfg, wallet, home);
            const channel =
                params.side === "incoming" ? entity.incomingChannel : entity.outgoingChannel;
            const result =
                params.kind === "device"
                    ? await revokeDeviceReader(
                          cfg,
                          wallet,
                          params.target,
                          params.side,
                          account,
                          home,
                      )
                    : await revokeAgentReader(
                          cfg,
                          wallet,
                          params.target,
                          params.side,
                          account,
                          home,
                      );
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                kind: params.kind,
                target: params.target,
                side: params.side,
                channel,
                account: result.reader,
            });
        },
    });
}
