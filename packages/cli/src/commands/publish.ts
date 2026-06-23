import {
  listDevices,
  loadConfig,
  loadWallet,
  publishMessage,
  resolveChannel,
  SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";

export const publishCommand = new Command("publish")
  .description("Publish a message to a device outgoing channel or any authorized channel")
  .option("--device <name>", "Device name (publishes to its outgoing channel)")
  .option("--channel <address>", "Direct channel address (publish to any authorized channel)")
  .option("--from <name>", "Envelope 'dev' field when using --channel (default: controller)", "controller")
  .requiredOption("--topic <topic>", "Message topic (e.g. telemetry.switch_status, command.switch.set)")
  .requiredOption("--data <json>", "Payload as JSON (e.g. '{\"on\":true}')")
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

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(opts.data);
    } catch {
      console.error("Invalid JSON payload. Example: '{\"on\":true}'");
      process.exit(1);
    }

    let channelAddress: `0x${string}`;
    let from: string;
    try {
      const resolved = resolveChannel({ device: opts.device, channel: opts.channel });
      channelAddress = resolved.channelAddress;
      // Device publishes identify as the device; direct channel uses --from.
      from = resolved.device ?? opts.from;
    } catch (e: unknown) {
      if (e instanceof SmartClawsError && e.code === "DEVICE_NOT_FOUND") {
        console.error(`Device '${opts.device}' not found.`);
        const devices = listDevices();
        if (devices.length > 0) {
          console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
        }
        process.exit(1);
      }
      console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
      process.exit(1);
    }

    const result = await publishMessage({ channelAddress, topic: opts.topic, payload, from }, config, wallet);

    if (opts.device) {
      console.log(`Published to ${from}/${result.topic}`);
    } else {
      console.log(`Published ${from}/${result.topic} to channel ${channelAddress}`);
    }
    console.log(`  Tx:     ${result.txHash}`);
    console.log(`  Status: ${result.status}`);
  });
