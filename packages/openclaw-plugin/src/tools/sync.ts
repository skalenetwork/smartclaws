import { loadWallet, syncLocalCacheBounded } from "@smartclaws/sdk";
import { Type } from "typebox";
import { maxSyncEntities, resolveConfig, resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function syncTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_sync",
        label: "SmartClaws Sync",
        description:
            "Refresh the local cache from the configured deployment, bounded by maxSyncEntities. Returns counts and whether synchronization completed. Does not return entity records. Writes local state. No automatic retries.",
        optional: true,
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const result = await syncLocalCacheBounded(resolveConfig(config), {
                wallet: loadWallet(home) ?? undefined,
                homeDir: home,
                maxEntities: maxSyncEntities(config),
            });
            throwIfAborted(context.signal);
            return jsonCompatible({
                status: result.complete ? "synced" : "incomplete",
                groupCount: result.groupCount,
                deviceCount: result.deviceCount,
                agentCount: result.agentCount,
                complete: result.complete,
            });
        },
    });
}
