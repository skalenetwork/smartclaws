import { Command } from "commander";
import { toHex } from "viem";
import { loadConfig } from "../config.ts";
import { getChannelContract, getClients } from "../contracts.ts";
import { listDevices, loadDevice } from "../device.ts";
import { encode } from "../envelope.ts";
import { loadWallet } from "../wallet.ts";

export const publishCommand = new Command("publish")
  .description("Publish a reading to a device's outgoing channel")
  .requiredOption("--device <name>", "Device name")
  .requiredOption("--topic <topic>", "Message topic (e.g. temperature, humidity)")
  .requiredOption("--data <json>", "Payload as JSON (e.g. '{\"temp\":22.5}')")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not initialized. Run 'smartclaws init' first.");
      process.exit(1);
    }

    const wallet = loadWallet();
    if (!wallet) {
      console.error("No wallet found. Run 'smartclaws init' first.");
      process.exit(1);
    }

    const device = loadDevice(opts.device);
    if (!device) {
      const devices = listDevices();
      console.error(`Device '${opts.device}' not found.`);
      if (devices.length > 0) {
        console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
      }
      process.exit(1);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(opts.data);
    } catch {
      console.error("Invalid JSON payload. Example: '{\"temp\":22.5}'");
      process.exit(1);
    }

    const encoded = encode(opts.topic, payload, device.name);
    const channel = getChannelContract(device.outgoingChannel as `0x${string}`, config, wallet);
    const { publicClient } = getClients(config, wallet);

    const hash = await channel.write.publishMessage([toHex(encoded)]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Published to ${device.name}/${opts.topic}`);
    console.log(`  Tx:     ${hash}`);
    console.log(`  Status: ${receipt.status}`);
  });
