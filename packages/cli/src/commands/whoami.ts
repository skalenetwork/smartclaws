import {
    getAgentReaderStatus,
    getDeviceReaderStatus,
    hasPublicKeyWithConfig,
    hydrateAgent,
    hydrateDevice,
    listAgents,
    listDevices,
    listGroups,
    loadAgent,
    loadDevice,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { entityKindLabel } from "../format.ts";
import { loadConfigOrExit, loadOptionalWalletOrExit } from "../runtime.ts";

function uniqueByAddress<T>(items: T[], addressOf: (item: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        const key = addressOf(item).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

export const whoamiCommand = new Command("whoami")
    .description("Show current SmartClaws HOME identity and attachments")
    .action(async () => {
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

        if (!wallet) return;

        try {
            const registered = await hasPublicKeyWithConfig(
                config,
                wallet.address as `0x${string}`,
            );
            console.log(`  Enc. key:  ${registered ? "registered" : "not registered"}`);
            if (!registered) {
                console.log("Register it with:");
                console.log("  smartclaws key register");
            }
        } catch {
            // whoami still works offline; key status is diagnostic.
        }

        const knownDevices = uniqueByAddress(
            [
                ...devices,
                ...config.attachedDeviceAddresses
                    .map((address) => loadDevice(address))
                    .filter((device): device is NonNullable<typeof device> => device !== null),
            ],
            (device) => device.deviceContract,
        );
        const knownAgents = uniqueByAddress(
            [
                ...agents,
                ...(config.attachedAgentAddress
                    ? [loadAgent(config.attachedAgentAddress)].filter(
                          (agent): agent is NonNullable<typeof agent> => agent !== null,
                      )
                    : []),
            ],
            (agent) => agent.agentContract,
        );

        const readerLines: string[] = [];
        for (const device of knownDevices) {
            if (device.encrypted !== true) continue;
            try {
                const status = await getDeviceReaderStatus(
                    config,
                    device.deviceContract,
                    wallet.address,
                );
                readerLines.push(
                    `    device ${device.name} (${entityKindLabel(true)}) incoming=${status.isIncomingReader} outgoing=${status.isOutgoingReader}`,
                );
            } catch {
                // Skip entities we cannot query; do not scan the rest of the chain.
            }
        }
        for (const address of config.attachedDeviceAddresses) {
            if (
                knownDevices.some(
                    (device) => device.deviceContract.toLowerCase() === address.toLowerCase(),
                )
            ) {
                continue;
            }
            try {
                const device = await hydrateDevice(address as `0x${string}`, config, wallet);
                if (device.encrypted !== true) continue;
                const status = await getDeviceReaderStatus(config, address, wallet.address);
                readerLines.push(
                    `    device ${device.name} (${entityKindLabel(true)}) incoming=${status.isIncomingReader} outgoing=${status.isOutgoingReader}`,
                );
            } catch {
                // Attached but uncached: one address lookup, never a global scan.
            }
        }
        for (const agent of knownAgents) {
            if (agent.encrypted !== true) continue;
            try {
                const status = await getAgentReaderStatus(
                    config,
                    agent.agentContract,
                    wallet.address,
                );
                readerLines.push(
                    `    agent ${agent.name} (${entityKindLabel(true)}) incoming=${status.isIncomingReader} outgoing=${status.isOutgoingReader}`,
                );
            } catch {
                // Skip entities we cannot query; do not scan the rest of the chain.
            }
        }
        if (
            config.attachedAgentAddress &&
            !knownAgents.some(
                (agent) =>
                    agent.agentContract.toLowerCase() === config.attachedAgentAddress.toLowerCase(),
            )
        ) {
            try {
                const agent = await hydrateAgent(
                    config.attachedAgentAddress as `0x${string}`,
                    config,
                    wallet,
                );
                if (agent.encrypted === true) {
                    const status = await getAgentReaderStatus(
                        config,
                        config.attachedAgentAddress,
                        wallet.address,
                    );
                    readerLines.push(
                        `    agent ${agent.name} (${entityKindLabel(true)}) incoming=${status.isIncomingReader} outgoing=${status.isOutgoingReader}`,
                    );
                }
            } catch {
                // Attached but uncached: one address lookup, never a global scan.
            }
        }

        if (readerLines.length > 0) {
            console.log("  Readers:");
            for (const line of readerLines) console.log(line);
        }
    });
