import { generateName } from "@smartclaws/core/names";
import { registerGroup, saveConfig } from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

export const registerCommand = new Command("register")
    .description("Register a new device group on-chain")
    .option("--name <name>", "Custom group name (random if not set)")
    .option("--skills <skills>", "Skills description", "")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        if (!config.contractAddress) {
            console.error("No registry contract address configured.");
            process.exit(1);
        }
        const existingGroup = config.attachedGroupAddress || config.deviceGroupAddress;
        if (existingGroup) {
            console.error(`Device group already attached: ${existingGroup}`);
            console.error("Only one device group per HOME is supported for now.");
            process.exit(1);
        }

        const wallet = loadWalletOrExit(config);

        const groupName = opts.name || generateName();
        console.log(`Registering device group '${groupName}'...`);
        const group = await registerGroup(config, wallet, groupName, opts.skills);

        config.deviceGroupAddress = group.groupAddress;
        config.attachedGroupAddress = group.groupAddress;
        saveConfig(config);

        console.log("Device group registered:");
        console.log(`  Name:     ${group.name}`);
        console.log(`  Address:  ${group.groupAddress}`);
        console.log(`  Created:  ${new Date(group.createdAt * 1000).toISOString()}`);
    });
