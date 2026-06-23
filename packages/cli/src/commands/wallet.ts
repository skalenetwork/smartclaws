import { getWalletInfo, loadConfig, loadWallet, SmartClawsError } from "@smartclaws/sdk";
import { Command } from "commander";

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
      const info = await getWalletInfo(config, wallet);
      console.log(`Balance: ${info.balance} ${info.symbol}`);
    } catch (e: unknown) {
      const msg = e instanceof SmartClawsError ? e.message : (e as Error).message;
      console.log(`Balance: error fetching (${msg})`);
    }
  });
