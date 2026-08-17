import { discloseTool } from "./disclose.js";
import { notifyTool } from "./notify.js";
import { publishTool } from "./publish.js";
import { readTool } from "./read.js";
import type { SmartClawsToolFactory } from "./types.js";
import { walletInfoTool } from "./wallet-info.js";

export function smartClawsTools(tool: SmartClawsToolFactory) {
    return [
        walletInfoTool(tool),
        readTool(tool),
        discloseTool(tool),
        publishTool(tool),
        notifyTool(tool),
    ];
}
