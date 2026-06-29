import {
  hydrateDevice,
  listDevices,
  loadDevice,
  publishChannelMessage,
  publishDeviceTelemetry,
  resolveChannel,
  SmartClawsError,
} from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

function printPublisherGuidance(deviceName: string, account: string, canGrant: boolean): void {
  console.error(`Wallet ${account} does not have publisher permission for device '${deviceName}'.`);
  if (canGrant) {
    console.error("Grant it with:");
    console.error(
      `  smartclaws device grant --device ${deviceName} --role publisher --account ${account}`,
    );
  } else {
    console.error("Ask a device admin to grant publisher permission:");
    console.error(
      `  smartclaws device grant --device ${deviceName} --role publisher --account ${account}`,
    );
  }
}

export const publishCommand = new Command("publish")
  .description("Publish a message through a device contract or directly to an authorized channel")
  .option("--device <name>", "Device name (publishes through SmartClawsDevice.publishTelemetry)")
  .option("--channel <address>", "Direct channel address (publish to any authorized channel)")
  .option(
    "--from <name>",
    "Envelope 'dev' field when using --channel (default: controller)",
    "controller",
  )
  .requiredOption(
    "--topic <topic>",
    "Message topic (e.g. telemetry.switch_status, command.switch.set)",
  )
  .requiredOption("--data <json>", `Payload as JSON (e.g. '{"on":true}')`)
  .action(async (opts) => {
    const config = loadConfigOrExit();
    const wallet = loadWalletOrExit(config);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(opts.data);
    } catch {
      console.error(`Invalid JSON payload. Example: '{"on":true}'`);
      process.exit(1);
    }

    try {
      if (Boolean(opts.device) === Boolean(opts.channel)) {
        throw new SmartClawsError(
          "INVALID_TARGET",
          "Provide exactly one of --device or --channel.",
        );
      }

      if (opts.device) {
        const device = loadDevice(opts.device);
        if (!device) {
          console.error(`Device '${opts.device}' not found.`);
          const devices = listDevices();
          if (devices.length > 0)
            console.error(`Available: ${devices.map((d) => d.name).join(", ")}`);
          process.exit(1);
        }

        const hydrated = await hydrateDevice(device.deviceContract, config, wallet);
        if (!hydrated.capabilities?.isPublisher) {
          printPublisherGuidance(
            hydrated.name,
            wallet.address,
            Boolean(hydrated.capabilities?.isDeviceAdmin),
          );
          process.exit(1);
        }

        const result = await publishDeviceTelemetry(
          {
            deviceAddress: hydrated.deviceContract as `0x${string}`,
            topic: opts.topic,
            payload,
            from: hydrated.name,
          },
          config,
          wallet,
        );
        console.log(`Published to ${hydrated.name}/${result.topic}`);
        console.log(`  Device:  ${hydrated.deviceContract}`);
        console.log(`  Channel: ${result.channel}`);
        console.log(`  Tx:      ${result.txHash}`);
        console.log(`  Status:  ${result.status}`);
        return;
      }

      const resolved = resolveChannel({ channel: opts.channel });
      const result = await publishChannelMessage(
        { channelAddress: resolved.channelAddress, topic: opts.topic, payload, from: opts.from },
        config,
        wallet,
      );
      console.log(`Published ${opts.from}/${result.topic} to channel ${resolved.channelAddress}`);
      console.log(`  Tx:     ${result.txHash}`);
      console.log(`  Status: ${result.status}`);
    } catch (e: unknown) {
      console.error(e instanceof SmartClawsError ? e.message : (e as Error).message);
      process.exit(1);
    }
  });
