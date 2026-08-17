import {
    assertNotSelfLockout,
    grantAgentPermission,
    grantDevicePermission,
    revokeAgentPermission,
    revokeDevicePermission,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { getAddress } from "viem";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { requireConfirmedReceipt, throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { AddressSchema } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

const RoleSchema = Type.Union(
    [
        Type.Literal("publisher"),
        Type.Literal("master"),
        Type.Literal("sender"),
        Type.Literal("agent-admin"),
    ],
    {
        description:
            "AccessControl role. Device: publisher|master. Agent: publisher|sender|agent-admin.",
    },
);

function requireKindRole(
    kind: "device" | "agent",
    role: "publisher" | "master" | "sender" | "agent-admin",
): void {
    if (kind === "device" && (role === "publisher" || role === "master")) return;
    if (kind === "agent" && (role === "publisher" || role === "sender" || role === "agent-admin")) {
        return;
    }
    throw new SmartClawsError(
        "INVALID_TARGET",
        kind === "device"
            ? "Device roles are publisher and master."
            : "Agent roles are publisher, sender, and agent-admin.",
        { kind, role },
    );
}

const sharedParams = {
    kind: Type.Union([Type.Literal("device"), Type.Literal("agent")]),
    target: Type.String({ description: "Entity address or local name." }),
    role: RoleSchema,
    account: AddressSchema,
};

export function roleGrantTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_role_grant",
        label: "SmartClaws Role Grant",
        description:
            "Grant an AccessControl role on a device or agent. Invalid cross-kind roles are rejected before RPC. Reader ACLs are a separate capability. No automatic retries.",
        optional: true,
        parameters: Type.Object(sharedParams),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            requireKindRole(params.kind, params.role);
            const account = getAddress(params.account);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            const result =
                params.kind === "device"
                    ? await grantDevicePermission(
                          cfg,
                          wallet,
                          params.target,
                          params.role === "master" ? "master" : "publisher",
                          account,
                          home,
                      )
                    : await grantAgentPermission(
                          cfg,
                          wallet,
                          params.target,
                          params.role === "publisher"
                              ? "publisher"
                              : params.role === "sender"
                                ? "sender"
                                : "agent-admin",
                          account,
                          home,
                      );
            requireConfirmedReceipt(result.status, result.txHash, "grantRole");
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                kind: params.kind,
                target: params.target,
                role: params.role,
                account: result.account,
            });
        },
    });
}

export function roleRevokeTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_role_revoke",
        label: "SmartClaws Role Revoke",
        description:
            "Revoke an AccessControl role on a device or agent. Refuses to revoke master or agent-admin from the active wallet unless allowSelfRevocation is true. This is stale-state protection, not a proof of last-admin. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            ...sharedParams,
            allowSelfRevocation: Type.Optional(
                Type.Boolean({
                    description:
                        "Required to revoke an administrative role from the active wallet.",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            requireKindRole(params.kind, params.role);
            const account = getAddress(params.account);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const home = resolvedHome(config);
            assertNotSelfLockout({
                walletAddress: wallet.address,
                account,
                role: params.role,
                allowSelfRevocation: params.allowSelfRevocation,
            });
            const result =
                params.kind === "device"
                    ? await revokeDevicePermission(
                          cfg,
                          wallet,
                          params.target,
                          params.role === "master" ? "master" : "publisher",
                          account,
                          home,
                      )
                    : await revokeAgentPermission(
                          cfg,
                          wallet,
                          params.target,
                          params.role === "publisher"
                              ? "publisher"
                              : params.role === "sender"
                                ? "sender"
                                : "agent-admin",
                          account,
                          home,
                      );
            requireConfirmedReceipt(result.status, result.txHash, "revokeRole");
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                kind: params.kind,
                target: params.target,
                role: params.role,
                account: result.account,
            });
        },
    });
}
