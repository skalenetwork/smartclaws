import { accessTool } from "./access.js";
import { backupListTool } from "./backups.js";
import { discloseTool } from "./disclose.js";
import { discoverTool } from "./discover.js";
import { listLocalTool } from "./list-local.js";
import { notifyTool } from "./notify.js";
import { publishTool } from "./publish.js";
import { readTool } from "./read.js";
import { readerListTool } from "./readers.js";
import { setupStatusTool } from "./setup-status.js";
import type { SmartClawsToolFactory } from "./types.js";
import { walletInfoTool } from "./wallet-info.js";

export function smartClawsTools(tool: SmartClawsToolFactory) {
    return [
        setupStatusTool(tool),
        walletInfoTool(tool),
        listLocalTool(tool),
        discoverTool(tool),
        accessTool(tool),
        readTool(tool),
        readerListTool(tool),
        backupListTool(tool),
        discloseTool(tool),
        publishTool(tool),
        notifyTool(tool),
    ];
}
