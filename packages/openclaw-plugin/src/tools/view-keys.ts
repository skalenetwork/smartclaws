import {
    forgetViewKeyChecked,
    generateViewKeyIfAbsent,
    registerActiveViewKey,
    removeRegisteredPublicKey,
    rotateViewKeyChecked,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function viewKeyGenerateTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_view_key_generate",
        label: "SmartClaws View Key Generate",
        description:
            "Generate a local viewing key distinct from the signing key. Only works when no separate viewing key exists. Returns a public fingerprint, never the private key. The key is not active for disclosures until registered. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const result = generateViewKeyIfAbsent(resolvedHome(config));
            return jsonCompatible({ status: "generated", ...result });
        },
    });
}

export function viewKeyRotateTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_view_key_rotate",
        label: "SmartClaws View Key Rotate",
        description:
            "Replace the local viewing key after creating a safety backup. Requires the current public fingerprint and confirmAbandonInflightDisclosures: true because in-flight disclosures may become unreadable. Does not register the new key. Never returns private keys or paths. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            expectedCurrentKeyFingerprint: Type.String({
                description: "Fingerprint of the currently active viewing public key.",
            }),
            confirmAbandonInflightDisclosures: Type.Boolean({
                description: "Must be true; rotating abandons in-flight paid disclosures.",
            }),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const result = rotateViewKeyChecked({
                homeDir: resolvedHome(config),
                expectedCurrentKeyFingerprint: params.expectedCurrentKeyFingerprint,
                confirmAbandonInflightDisclosures: params.confirmAbandonInflightDisclosures,
            });
            return jsonCompatible({ status: "rotated", ...result });
        },
    });
}

export function viewKeyRegisterTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_view_key_register",
        label: "SmartClaws View Key Register",
        description:
            "Register the active viewing public key on-chain, wait for a successful receipt, and verify it matches the local viewing key. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const result = await registerActiveViewKey(
                resolveConfig(config),
                requireWallet(config),
            );
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                registry: result.registry,
                account: result.account,
                fingerprint: result.fingerprint,
                matchesViewKey: result.matchesViewKey,
            });
        },
    });
}

export function viewKeyForgetTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_view_key_forget",
        label: "SmartClaws View Key Forget",
        description:
            "Delete the local viewing key after a safety backup. Disclose and register fail until a new one is generated. Returns registrationRequired: true. Never returns private keys. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const result = forgetViewKeyChecked(resolvedHome(config));
            return jsonCompatible({ status: "forgotten", ...result });
        },
    });
}

export function viewKeyRemoveTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_view_key_remove",
        label: "SmartClaws View Key Remove",
        description:
            "Remove this wallet's public key from the on-chain registry. Local key material is unchanged. Waits for a successful receipt and verifies the postcondition. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const result = await removeRegisteredPublicKey(
                resolveConfig(config),
                requireWallet(config),
            );
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "confirmed",
                txHash: result.txHash,
                registry: result.registry,
                account: result.account,
                fingerprint: result.fingerprint,
                registered: result.registered,
            });
        },
    });
}
