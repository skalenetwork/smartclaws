import { listAgents, listDevices, listGroups } from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadOptionalWalletOrExit } from "../runtime.ts";

export const whoamiCommand = new Command("whoami")
    .description("Show current SmartClaws HOME identity and attachments")
    .action(() => {
        const config = loadConfigOrExit();
        const wallet = loadOptionalWalletOrExit(config);
        console.log("SmartClaws HOME");
        console.log(`  Network:   ${config.network}`);
        console.log(`  RPC URL:   ${config.rpcUrl}`);
        console.log(`  Chain ID:  ${config.chainId}`);
        if (config.contractAddress) console.log(`  Contract:  ${config.contractAddress}`);
        console.log(`  Mode:      ${config.mode}`);
        console.log(`  Wallet:    ${wallet?.address ?? "missing"}`);
        if (config.attachedGroupAddress) console.log(`  Group:     ${config.attachedGroupAddress}`);
        if (config.attachedAgentAddress) console.log(`  Agent:     ${config.attachedAgentAddress}`);
        if (config.attachedDeviceAddresses.length > 0)
            console.log(`  Devices:   ${config.attachedDeviceAddresses.join(", ")}`);

        const groups = listGroups();
        const devices = listDevices();
        const agents = listAgents();
        if (groups.length || devices.length || agents.length) {
            console.log(
                "  Cache:     " +
                    groups.length +
                    " groups, " +
                    devices.length +
                    " devices, " +
                    agents.length +
                    " agents",
            );
        }
    });
