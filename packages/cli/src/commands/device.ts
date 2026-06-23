import { Command } from "commander";
import { type Address, decodeEventLog } from "viem";
import {
  getClients,
  getDeviceContract,
  getDeviceGroupContract,
  listDevices,
  loadConfig,
  loadDevice,
  loadWallet,
  saveDevice,
} from "@smartclaws/sdk";

const DEFAULT_CHANNEL_CAPACITY = 1024 * 1024;

export const deviceCommand = new Command("device").description("Device management");

deviceCommand
  .command("register")
  .description("Register a new device in the device group")
  .requiredOption("--name <name>", "Device name/identifier")
  .option("--capacity <bytes>", "Channel capacity in bytes", String(DEFAULT_CHANNEL_CAPACITY))
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not initialized. Run 'smartclaws init' first.");
      process.exit(1);
    }
    if (!config.deviceGroupAddress) {
      console.error("No device group registered. Run 'smartclaws register' first.");
      process.exit(1);
    }

    const wallet = loadWallet();
    if (!wallet) {
      console.error("No wallet found. Run 'smartclaws init' first.");
      process.exit(1);
    }

    const existing = loadDevice(opts.name);
    if (existing) {
      console.error(`Device '${opts.name}' is already registered.`);
      console.error(`  Outgoing channel: ${existing.outgoingChannel}`);
      process.exit(1);
    }

    const groupAddress = config.deviceGroupAddress as Address;
    const group = getDeviceGroupContract(groupAddress, config, wallet);
    const { publicClient, account } = getClients(config, wallet);

    console.log(`Registering device '${opts.name}'...`);

    const hash = await group.write.registerDevice([
      opts.name,
      account.address,
      BigInt(opts.capacity),
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let deviceAddress: Address | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== groupAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: group.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "DeviceRegistered") {
          deviceAddress = (decoded.args as unknown as { device: Address }).device;
        }
      } catch {}
    }

    if (!deviceAddress) {
      console.error("Failed to parse DeviceRegistered event.");
      process.exit(1);
    }

    const device = getDeviceContract(deviceAddress, config);
    const incomingChannel = (await device.read.incomingChannel()) as Address;
    const outgoingChannel = (await device.read.outgoingChannel()) as Address;

    saveDevice({
      name: opts.name,
      deviceContract: deviceAddress,
      incomingChannel,
      outgoingChannel,
    });

    console.log(`Device registered:`);
    console.log(`  Name:      ${opts.name}`);
    console.log(`  Contract:  ${deviceAddress}`);
    console.log(`  Outgoing:  ${outgoingChannel}`);
    console.log(`  Incoming:  ${incomingChannel}`);
    console.log(`  Tx:        ${hash}`);
  });

deviceCommand
  .command("list")
  .description("List registered devices")
  .action(() => {
    const devices = listDevices();
    if (devices.length === 0) {
      console.log("No devices registered.");
      return;
    }
    for (const d of devices) {
      console.log(`${d.name}`);
      console.log(`  Contract:  ${d.deviceContract}`);
      console.log(`  Outgoing:  ${d.outgoingChannel}`);
      console.log(`  Incoming:  ${d.incomingChannel}`);
    }
  });
