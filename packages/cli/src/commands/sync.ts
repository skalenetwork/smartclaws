import { syncLocalCache } from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadOptionalWalletOrExit } from "../runtime.ts";

export const syncCommand = new Command("sync")
    .description("Refresh local SmartClaws cache from on-chain registry data")
    .action(async () => {
        const config = loadConfigOrExit();
        const wallet = loadOptionalWalletOrExit(config);
        const result = await syncLocalCache(config, wallet);
        console.log("Sync complete");
        console.log(`  Groups:  ${result.groups.length}`);
        console.log(`  Devices: ${result.devices.length}`);
        console.log(`  Agents:  ${result.agents.length}`);
    });
