import { Command } from "commander";
import { type Address, getContract, toBytes } from "viem";
import SmartClawsChannelABI from "../../../abi/SmartClawsChannel.json" with { type: "json" };
import { loadConfig } from "../config.ts";
import { getClients } from "../contracts.ts";
import { listDevices, loadDevice } from "../device.ts";
import { decode } from "../envelope.ts";
import { loadWallet } from "../wallet.ts";

export const readCommand = new Command("read")
  .description("Read messages from a device's outgoing channel")
  .requiredOption("--device <name>", "Device name")
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

    const { publicClient } = getClients(config, wallet);
    const channel = getContract({
      address: device.outgoingChannel as Address,
      abi: SmartClawsChannelABI.abi,
      client: publicClient,
    });

    const count = (await channel.read.getMessageCount()) as bigint;
    if (count === 0n) {
      console.log("No messages.");
      return;
    }

    const oldest = (await channel.read.getOldestMessageOffset()) as bigint;
    const latest = (await channel.read.getLatestMessageOffset()) as bigint;
    const available = latest - oldest + 1n;
    const limit = BigInt(opts.limit) > available ? available : BigInt(opts.limit);
    const from =
      opts.offset !== undefined
        ? BigInt(opts.offset)
        : latest - limit + 1n < oldest
          ? oldest
          : latest - limit + 1n;
    const readCount = from + limit > latest + 1n ? latest + 1n - from : limit;

    const [payloads, offsets] = (await channel.read.readMessages([from, readCount])) as [
      readonly `0x${string}`[],
      readonly bigint[],
    ];

    if (opts.json) {
      const messages = payloads.map((p, i) => {
        try {
          const env = decode(toBytes(p));
          return { offset: Number(offsets[i]), ...env };
        } catch {
          return { offset: Number(offsets[i]), raw: p };
        }
      });
      console.log(
        JSON.stringify(
          {
            device: device.name,
            channel: device.outgoingChannel,
            total: Number(count),
            oldest: Number(oldest),
            latest: Number(latest),
            messages,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`Messages: ${count} total (offsets ${oldest}..${latest})`);
    console.log(`Reading: ${from}..${from + readCount - 1n}\n`);

    for (let i = 0; i < payloads.length; i++) {
      if (opts.raw) {
        console.log(`[${offsets[i]}] ${payloads[i]}`);
      } else {
        try {
          const env = decode(toBytes(payloads[i]));
          const ts = new Date(env.ts * 1000).toISOString();
          console.log(`[${offsets[i]}] ${ts} ${env.dev}/${env.topic} ${JSON.stringify(env.p)}`);
        } catch {
          console.log(`[${offsets[i]}] (decode error) ${payloads[i].slice(0, 40)}...`);
        }
      }
    }
  });
