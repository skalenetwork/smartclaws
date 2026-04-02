import { generateName } from "@smartclaws/core/names";
import { Command } from "commander";
import { type Address, decodeEventLog } from "viem";
import { loadConfig, saveConfig } from "../config.ts";
import { getClients, getRegistryContract } from "../contracts.ts";
import { loadWallet } from "../wallet.ts";

export const registerCommand = new Command("register")
  .description("Register a new device group on-chain")
  .option("--name <name>", "Custom group name (random if not set)")
  .option("--skills <skills>", "Skills description", "")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not initialized. Run 'smartclaws init' first.");
      process.exit(1);
    }
    if (!config.contractAddress) {
      console.error("No registry contract address configured.");
      process.exit(1);
    }
    if (config.deviceGroupAddress) {
      console.error(`Device group already registered: ${config.deviceGroupAddress}`);
      console.error("Only one device group per machine is supported.");
      process.exit(1);
    }

    const wallet = loadWallet();
    if (!wallet) {
      console.error("No wallet found. Run 'smartclaws init' first.");
      process.exit(1);
    }

    const groupName = opts.name || generateName();
    const registry = getRegistryContract(config, wallet);
    const { publicClient } = getClients(config, wallet);

    console.log(`Registering device group '${groupName}'...`);

    const hash = await registry.write.registerDeviceGroup([groupName, opts.skills]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let groupAddress: Address | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.contractAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: registry.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "DeviceGroupRegistered") {
          groupAddress = (decoded.args as unknown as { deviceGroup: Address }).deviceGroup;
        }
      } catch {}
    }

    if (!groupAddress) {
      console.error("Failed to parse DeviceGroupRegistered event.");
      process.exit(1);
    }

    config.deviceGroupAddress = groupAddress;
    saveConfig(config);

    console.log(`Device group registered:`);
    console.log(`  Name:     ${groupName}`);
    console.log(`  Address:  ${groupAddress}`);
    console.log(`  Tx:       ${hash}`);
  });
