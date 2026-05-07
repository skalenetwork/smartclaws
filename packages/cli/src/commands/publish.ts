import { encode } from "@smartclaws/core/envelope";
import { Command } from "commander";
import { toHex } from "viem";
import { loadConfig } from "../config.ts";
import { getChannelContract, getClients } from "../contracts.ts";
import { listDevices, loadDevice } from "../device.ts";
import { loadWallet } from "../wallet.ts";

export const publishCommand = new Command("publish")
  .description("Publish a message to a device outgoing channel or any authorized channel")
  .option("--device <name>", "Device name (publishes to its outgoing channel)")
  .option("--channel <address>", "Direct channel address (publish to any authorized channel)")
  .option("--from <name>", "Envelope 'dev' field when using --channel (default: controller)", "controller")
  .requiredOption("--topic <topic>", "Message topic (e.g. telemetry.switch_status, command.switch.set)")
  .requiredOption("--data <json>", "Payload as JSON (e.g. '{\"on\":true}')")
  .action(async (opts) => {
    if (!opts.device && !opts.channel) {
      console.error("Provide --device or --channel.");
      process.exit(1);
    }
    if (opts.device && opts.channel) {
      console.error("Provide --device or --channel, not both.");
      process.exit(1);
    }

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

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(opts.data);
    } catch {
      console.error("Invalid JSON payload. Example: '{\"on\":true}'");
      process.exit(1);
    }

    const { publicClient } = getClients(config, wallet);

    if (opts.device) {
      const device = loadDevice(opts.device);
      if (!device) {
        const devices = listDevices();
        console.error(`Device '${opts.device}' not found.`);
        if (devices.length > 0) {
          console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
        }
        process.exit(1);
      }

      const encoded = encode(opts.topic, payload, device.name);
      const channel = getChannelContract(device.outgoingChannel as `0x${string}`, config, wallet);
      const hash = await channel.write.publishMessage([toHex(encoded)]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log(`Published to ${device.name}/${opts.topic}`);
      console.log(`  Tx:     ${hash}`);
      console.log(`  Status: ${receipt.status}`);
    } else {
      const encoded = encode(opts.topic, payload, opts.from);
      const channel = getChannelContract(opts.channel as `0x${string}`, config, wallet);
      const hash = await channel.write.publishMessage([toHex(encoded)]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log(`Published ${opts.from}/${opts.topic} to channel ${opts.channel}`);
      console.log(`  Tx:     ${hash}`);
      console.log(`  Status: ${receipt.status}`);
    }
  });
