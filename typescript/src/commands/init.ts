import { Command } from "commander";
import { createDefaultConfig, loadConfig, saveConfig } from "../config.ts";
import { DEFAULT_NETWORK, getNetwork, NETWORKS } from "../defaults.ts";
import { generateWallet, loadWallet } from "../wallet.ts";

export const initCommand = new Command("init")
  .description("Initialize SmartClaws configuration and wallet")
  .option(
    "--network <name>",
    `Network to use (${Object.keys(NETWORKS).join(", ")})`,
    DEFAULT_NETWORK,
  )
  .option("--rpc-url <url>", "Custom RPC endpoint URL (overrides network default)")
  .option("--chain-id <id>", "Custom chain ID (overrides network default)")
  .option("--contract <address>", "SmartClaws registry contract address", "")
  .action((opts) => {
    const existing = loadConfig();
    if (existing) {
      console.log("Config already exists at ~/.smartclaws/config.json");
      console.log(`  Network:   ${existing.network}`);
      console.log(`  RPC URL:   ${existing.rpcUrl}`);
      console.log(`  Chain ID:  ${existing.chainId}`);
      if (existing.contractAddress) {
        console.log(`  Contract:  ${existing.contractAddress}`);
      }
    } else {
      const network = getNetwork(opts.network);
      const rpcUrl = opts.rpcUrl ?? network.rpcUrl;
      const chainId = opts.chainId ? Number(opts.chainId) : network.chainId;
      const contractAddress = opts.contract || network.registryAddress;

      const config = createDefaultConfig(opts.network, rpcUrl, chainId, contractAddress);
      saveConfig(config);
      console.log(`Config created at ~/.smartclaws/config.json`);
      console.log(`  Network:   ${network.name}`);
      console.log(`  RPC URL:   ${rpcUrl}`);
      console.log(`  Chain ID:  ${chainId}`);
      if (contractAddress) {
        console.log(`  Contract:  ${contractAddress}`);
      }
    }

    const wallet = loadWallet();
    if (wallet) {
      console.log(`  Wallet:    ${wallet.address}`);
    } else {
      const newWallet = generateWallet();
      console.log(`  Wallet:    ${newWallet.address} (generated)`);
    }
  });
