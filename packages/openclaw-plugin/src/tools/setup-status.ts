import { getSetupStatus } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome, setupOverrides } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function setupStatusTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_setup_status",
        label: "SmartClaws Setup Status",
        description:
            "Describe this agent's SmartClaws setup even when no HOME, config, or wallet exists. Returns the current state, what is missing, a HOME fingerprint for stale-state checks, and recommended next tools. Never returns private keys, wallet files, or filesystem paths. RPC failures are reported as diagnostics rather than failing the whole call.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const status = await getSetupStatus({
                homeDir: resolvedHome(config),
                overrides: setupOverrides(config),
            });
            throwIfAborted(context.signal);
            return jsonCompatible(status);
        },
    });
}
