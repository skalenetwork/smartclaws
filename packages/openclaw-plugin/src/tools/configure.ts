import { loadConfig, resetHomeChecked, updateHomeConfig } from "@smartclaws/sdk";
import { Type } from "typebox";
import { pluginShadowedFields, resolvedHome } from "../plugin-config.js";
import { requireConfirm, throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { ModeSchema } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function configureTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_configure",
        label: "SmartClaws Configure",
        description:
            "Patch the current SmartClaws HOME configuration. Requires expectedFingerprint. Named-network or custom RPC/chain/registry changes are written atomically. Refuses deployment changes while attachments exist — use smartclaws_home_reset first. Does not mutate OpenClaw plugin config. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            expectedFingerprint: Type.String({
                description: "HOME fingerprint from smartclaws_setup_status.",
            }),
            network: Type.Optional(
                Type.String({ description: "Named network key, e.g. base-testnet." }),
            ),
            rpcUrl: Type.Optional(
                Type.String({ description: "Custom HTTP(S) RPC URL. Privileged." }),
            ),
            chainId: Type.Optional(Type.Number({ description: "Custom chain ID." })),
            registryAddress: Type.Optional(
                Type.String({ description: "Registry contract address." }),
            ),
            mode: Type.Optional(ModeSchema),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const result = updateHomeConfig({
                homeDir: home,
                expectedFingerprint: params.expectedFingerprint,
                allowPrivateRpc: config.allowPrivateRpc === true,
                patch: {
                    network: params.network,
                    rpcUrl: params.rpcUrl,
                    chainId: params.chainId,
                    registryAddress: params.registryAddress,
                    mode: params.mode,
                },
            });
            throwIfAborted(context.signal);
            const persisted = loadConfig(home);
            return jsonCompatible({
                status: "updated",
                ...result,
                shadowedFields: pluginShadowedFields(config, persisted),
            });
        },
    });
}

export function homeResetTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_home_reset",
        label: "SmartClaws Home Reset",
        description:
            "Reset a stale or deployment-bound HOME: create a safety backup, preserve the signing wallet and viewing key, and clear deployment-bound attachments and records. Requires expectedFingerprint and confirm: true. Returns the backup name, never its path. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            expectedFingerprint: Type.String({
                description: "HOME fingerprint from smartclaws_setup_status.",
            }),
            reason: Type.Union([Type.Literal("stale-config"), Type.Literal("deployment-change")], {
                description: "Why the HOME is being reset.",
            }),
            confirm: Type.Boolean({ description: "Must be true to proceed." }),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            requireConfirm(params.confirm, "smartclaws_home_reset");
            const result = resetHomeChecked({
                homeDir: resolvedHome(config),
                expectedFingerprint: params.expectedFingerprint,
                reason: params.reason,
            });
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "reset",
                ...result,
            });
        },
    });
}
