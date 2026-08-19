import { initializeHome } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { ModeSchema } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function initializeTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_initialize",
        label: "SmartClaws Initialize",
        description:
            "Initialize SmartClaws configuration and generate a signing wallet locally when one does not already exist. Resumes a wallet-only HOME after reset or interrupted setup without replacing its key. Named networks only — custom RPC belongs in smartclaws_configure. Refuses existing configuration. Does not register anything on-chain and never returns the private key. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            mode: ModeSchema,
            network: Type.String({
                description: "Named network key from @smartclaws/core/networks, e.g. base-testnet.",
            }),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const result = initializeHome({
                homeDir: resolvedHome(config),
                mode: params.mode,
                network: params.network,
            });
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: "initialized",
                ...result,
                recommendedNextStep:
                    "Fund this wallet, then call smartclaws_setup_status to see remaining setup steps.",
                recommendedTool: "smartclaws_setup_status",
            });
        },
    });
}
