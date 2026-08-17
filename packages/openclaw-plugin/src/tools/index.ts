import { accessTool } from "./access.js";
import { attachTool } from "./attach.js";
import { backupListTool } from "./backups.js";
import { configureTool, homeResetTool } from "./configure.js";
import { discloseTool } from "./disclose.js";
import { discoverTool } from "./discover.js";
import { initializeTool } from "./initialize.js";
import { listLocalTool } from "./list-local.js";
import { notifyTool } from "./notify.js";
import { publishTool } from "./publish.js";
import { readTool } from "./read.js";
import { readerListTool } from "./readers.js";
import { registerAgentTool } from "./register-agent.js";
import { registerDeviceTool } from "./register-device.js";
import { registerGroupTool } from "./register-group.js";
import { setupStatusTool } from "./setup-status.js";
import { syncTool } from "./sync.js";
import type { SmartClawsToolFactory } from "./types.js";
import { walletInfoTool } from "./wallet-info.js";

export function smartClawsTools(tool: SmartClawsToolFactory) {
    return [
        setupStatusTool(tool),
        initializeTool(tool),
        configureTool(tool),
        attachTool(tool),
        syncTool(tool),
        homeResetTool(tool),
        registerGroupTool(tool),
        registerDeviceTool(tool),
        registerAgentTool(tool),
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
