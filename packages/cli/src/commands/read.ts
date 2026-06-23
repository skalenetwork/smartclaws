import { listDevices, loadConfig, readMessages, resolveChannel, SmartClawsError } from "@smartclaws/sdk";
import { Command } from "commander";

export const readCommand = new Command("read")
  .description("Read messages from a device's outgoing channel")
  .option("--device <name>", "Device name (reads from local device config)")
  .option("--channel <address>", "Channel address (reads directly, no local device needed)")
  .option("--limit <n>", "Number of messages to read", "10")
  .option("--offset <n>", "Start reading from this offset")
  .option("--raw", "Show raw hex instead of decoded envelopes")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not initialized. Run 'smartclaws init' first.");
      process.exit(1);
    }

    let channelAddress: `0x${string}`;
    let deviceName: string | undefined;
    try {
      const resolved = resolveChannel({ device: opts.device, channel: opts.channel });
      channelAddress = resolved.channelAddress;
      deviceName = resolved.device;
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

    const result = await readMessages(
      {
        channelAddress,
        limit: Number(opts.limit),
        offset: opts.offset !== undefined ? Number(opts.offset) : undefined,
      },
      config,
    );

    if (result.total === 0) {
      if (opts.json) {
        console.log(
          JSON.stringify(
            { device: deviceName ?? null, channel: channelAddress, total: 0, messages: [] },
            null,
            2,
          ),
        );
      } else {
        console.log("No messages.");
      }
      return;
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            device: deviceName ?? null,
            channel: result.channel,
            total: result.total,
            oldest: result.oldest,
            latest: result.latest,
            messages: result.messages,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`Messages: ${result.total} total (offsets ${result.oldest}..${result.latest})`);
    console.log(`Reading: ${result.from}..${result.to}\n`);

    for (const m of result.messages) {
      if (opts.raw) {
        console.log(`[${m.offset}] ${m.rawHex}`);
      } else if (m.decodeError) {
        console.log(`[${m.offset}] (decode error) ${m.rawHex.slice(0, 40)}...`);
      } else {
        const ts = new Date((m.ts ?? 0) * 1000).toISOString();
        console.log(`[${m.offset}] ${ts} ${m.dev}/${m.topic} ${JSON.stringify(m.p)}`);
      }
    }
  });
