#!/usr/bin/env bun
/**
 * dev/authorize-controller.ts
 *
 * Grants a controller wallet write access to a device's incoming channel.
 * Run this once after device registration, before starting the controller agent.
 *
 * How it works:
 *   The device incoming channel is owned by the SmartClawsDeviceGroup contract.
 *   Only the group contract can add publishers to that channel.
 *   This script calls SmartClawsDeviceGroup.addIncomingPublisher(), which the
 *   group owner (publisher wallet) is authorized to invoke.
 *
 * Usage:
 *   SMARTCLAWS_HOME=~/.sc-publisher bun dev/authorize-controller.ts <device-name> <controller-wallet-address>
 *
 * Example:
 *   SMARTCLAWS_HOME=~/.sc-publisher bun dev/authorize-controller.ts shelly-plug-s 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import SmartClawsDeviceGroupABI from "../packages/core/abi/SmartClawsDeviceGroup.json" with { type: "json" };
import { createPublicClient, createWalletClient, defineChain, getContract, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SC_HOME = process.env.SMARTCLAWS_HOME ?? join(process.env.HOME!, ".sc-publisher");

const [deviceName, controllerAddress] = process.argv.slice(2);
if (!deviceName || !controllerAddress) {
  console.error(
    "Usage: SMARTCLAWS_HOME=~/.sc-publisher bun dev/authorize-controller.ts <device-name> <controller-wallet-address>",
  );
  process.exit(1);
}

if (!/^0x[0-9a-fA-F]{40}$/.test(controllerAddress)) {
  console.error(`Invalid wallet address: ${controllerAddress}`);
  process.exit(1);
}

// Load publisher config and wallet
const config = JSON.parse(readFileSync(join(SC_HOME, "config.json"), "utf-8"));
const wallet = JSON.parse(readFileSync(join(SC_HOME, "wallets/default.json"), "utf-8"));
const device = JSON.parse(readFileSync(join(SC_HOME, `devices/${deviceName}.json`), "utf-8"));

if (!config.deviceGroupAddress) {
  console.error("No device group registered in publisher config.");
  process.exit(1);
}

const chain = defineChain({
  id: config.chainId,
  name: "local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

const group = getContract({
  address: config.deviceGroupAddress as `0x${string}`,
  abi: SmartClawsDeviceGroupABI.abi,
  client: { public: publicClient, wallet: walletClient },
});

console.log(`Publisher config:  ${SC_HOME}`);
console.log(`Device group:      ${config.deviceGroupAddress}`);
console.log(`Device contract:   ${device.deviceContract}`);
console.log(`Incoming channel:  ${device.incomingChannel}`);
console.log(`Granting access to: ${controllerAddress}`);
console.log();

const hash = await group.write.addIncomingPublisher([
  device.deviceContract as `0x${string}`,
  controllerAddress as `0x${string}`,
]);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`Done. Tx: ${hash}`);
console.log(`Status: ${receipt.status}`);
console.log();
console.log(`The controller wallet can now publish to:`);
console.log(`  ${device.incomingChannel}`);
