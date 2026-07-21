import { getWalletInfo, SmartClawsError } from "@smartclaws/sdk";
import { Command } from "commander";
import { loadConfigOrExit, loadWalletOrExit } from "../runtime.ts";

export const walletCommand = new Command("wallet").description("Wallet management");

walletCommand
  .command("info")
  .description("Show wallet address and balance")
  .action(async () => {
    const config = loadConfigOrExit();
    const wallet = loadWalletOrExit(config);

    console.log(`Address: ${wallet.address}`);

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
