import { listPresentedBackups } from "@smartclaws/sdk";
import { Type } from "typebox";
import { resolvedHome } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function backupListTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_backup_list",
        label: "SmartClaws Backup List",
        description:
            "List local SmartClaws HOME backups by name, creation time, size, and fingerprint. Never returns filesystem paths. Backup files contain the signing key — treat names as sensitive operational data, not as something to print into logs with paths.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const backups = listPresentedBackups(resolvedHome(config));
            return jsonCompatible({ backups });
        },
    });
}
