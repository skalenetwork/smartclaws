import { Command } from "commander";
import { type Address, formatEther } from "viem";
import { createClient } from "../client.ts";
import { loadConfig } from "../config.ts";
import { NETWORKS } from "../defaults.ts";
import { loadWallet } from "../wallet.ts";

export const walletCommand = new Command("wallet").description("Wallet management");

walletCommand
  .command("info")
  .description("Show wallet address and balance")
  .action(async () => {
    const wallet = loadWallet();
    if (!wallet) {
      console.error("No wallet found. Run 'smartclaws init' first.");
      process.exit(1);
    }

    console.log(`Address: ${wallet.address}`);

    const config = loadConfig();
    if (!config?.rpcUrl) {
      console.log("Balance: unknown (no RPC configured)");
      return;
    }

    try {
      const client = createClient(config);
      const balance = await client.getBalance({ address: wallet.address as Address });
      const symbol = NETWORKS[config.network]?.nativeCurrency.symbol ?? "sFUEL";
      console.log(`Balance: ${formatEther(balance)} ${symbol}`);
    } catch (e: unknown) {
      console.log(`Balance: error fetching (${(e as Error).message})`);
    }
  });
