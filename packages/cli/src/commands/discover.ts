import {
    discoverAgents,
    discoverDevices,
    discoverGroups,
    discoverOwnedAgents,
    resolveGroup,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadOptionalWalletOrExit } from "../runtime.ts";

function date(seconds?: number): string {
    return seconds ? new Date(seconds * 1000).toISOString() : "unknown";
}

export const discoverCommand = new Command("discover").description(
    "Discover on-chain SmartClaws entities",
);

discoverCommand
    .command("groups")
    .description("List registry device groups")
    .option("--verbose", "Show addresses, owners, createdAt, and counts")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadOptionalWalletOrExit(config);
        const groups = await discoverGroups(config, wallet);
        if (groups.length === 0) {
            console.log("No groups found.");
            return;
        }
        for (const group of groups) {
            console.log(`${group.name} (${group.deviceCount} devices)`);
            if (opts.verbose) {
                console.log(`  Address:  ${group.groupAddress}`);
                console.log(`  Owner:    ${group.owner}`);
                console.log(`  Created:  ${date(group.createdAt)}`);
            }
        }
    });

discoverCommand
    .command("devices")
    .description("List devices in a group")
    .requiredOption("--group <address-or-name>", "Group address or name")
    .option("--verbose", "Show contract/channel addresses and createdAt")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadOptionalWalletOrExit(config);
        const group = await resolveGroup(opts.group, config, wallet);
        const devices = await discoverDevices(config, group.groupAddress, wallet);
        if (devices.length === 0) {
            console.log("No devices found.");
            return;
        }
        for (const device of devices) {
            console.log(device.name);
            if (opts.verbose) {
                console.log(`  Contract:  ${device.deviceContract}`);
                console.log(`  Group:     ${device.groupAddress ?? group.groupAddress}`);
                console.log(`  Outgoing:  ${device.outgoingChannel}`);
                console.log(`  Incoming:  ${device.incomingChannel}`);
                console.log(`  Created:   ${date(device.createdAt)}`);
            }
        }
    });

discoverCommand
    .command("agents")
    .description("List registry agents")
    .option("--owned", "Only show agents owned by the local wallet")
    .option("--verbose", "Show contract/channel addresses and createdAt")
    .action(async (opts) => {
        const config = loadConfigOrExit();
        const wallet = loadOptionalWalletOrExit(config);
        const agents =
            opts.owned && wallet
                ? await discoverOwnedAgents(config, wallet)
                : await discoverAgents(config, wallet);
        if (agents.length === 0) {
            console.log("No agents found.");
            return;
        }
        for (const agent of agents) {
            console.log(agent.name);
            if (opts.verbose) {
                console.log(`  Contract:  ${agent.agentContract}`);
                console.log(`  Owner:     ${agent.owner ?? "unknown"}`);
                console.log(`  Outgoing:  ${agent.outgoingChannel}`);
                console.log(`  Incoming:  ${agent.incomingChannel}`);
                console.log(`  Created:   ${date(agent.createdAt)}`);
            }
        }
    });
