#!/usr/bin/env bun
/**
 * dev/create-agent-channel.ts
 *
 * Creates a standalone channel on-chain owned by the master wallet.
 * Temporary workaround while SmartClaws.registerAgent() is unavailable on the deployed instance.
 * The master agent uses this channel as its decision log (AGENT_OUTGOING_CHANNEL).
 *
 * Usage:
 *   SMARTCLAWS_HOME=~/.sc-master bun dev/create-agent-channel.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import SmartClawsABI from "../packages/core/abi/SmartClaws.json" with { type: "json" };
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SC_HOME = process.env.SMARTCLAWS_HOME ?? join(process.env.HOME!, ".sc-master");
const CAPACITY = 1024 * 1024; // 1 MB

const config = JSON.parse(readFileSync(join(SC_HOME, "config.json"), "utf-8"));
const wallet = JSON.parse(readFileSync(join(SC_HOME, "wallets/default.json"), "utf-8"));

const chain = defineChain({
  id: config.chainId,
  name: "local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

const registry = getContract({
  address: config.contractAddress as `0x${string}`,
  abi: SmartClawsABI.abi,
  client: { public: publicClient, wallet: walletClient },
});

console.log(`Creating agent decision log channel...`);
console.log(`  Owner:    ${account.address}`);
console.log(`  Capacity: ${CAPACITY} bytes`);
console.log();

const hash = await registry.write.createChannel([account.address, BigInt(CAPACITY)]);
const receipt = await publicClient.waitForTransactionReceipt({ hash });

let channelAddress: string | null = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== config.contractAddress.toLowerCase()) continue;
  try {
    const decoded = decodeEventLog({
      abi: SmartClawsABI.abi,
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName === "ChannelCreated") {
      channelAddress = (decoded.args as { channel: string }).channel;
    }
  } catch {}
}

if (!channelAddress) {
  console.error("Failed to parse ChannelCreated event.");
  process.exit(1);
}

const agentsDir = join(SC_HOME, "agents");
if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
writeFileSync(
  join(agentsDir, "shelly-master.json"),
  `${JSON.stringify({ name: "shelly-master", outgoingChannel: channelAddress }, null, 2)}\n`,
);

console.log(`Channel created:`);
console.log(`  Address: ${channelAddress}`);
console.log(`  Tx:      ${hash}`);
console.log();
console.log(`export MASTER_OUTGOING=${channelAddress}`);
console.log(`export MASTER_WALLET=${account.address}`);
