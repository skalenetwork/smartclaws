import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WalletFile } from "@smartclaws/core/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureConfigDir, getConfigDir } from "./config.js";

export type { WalletFile };

function walletPath(homeDir?: string): string {
  return join(getConfigDir(homeDir), "wallets", "default.json");
}

export function generateWallet(homeDir?: string): WalletFile {
  ensureConfigDir(homeDir);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: WalletFile = { address: account.address, privateKey };
  writeFileSync(walletPath(homeDir), `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return wallet;
}

export function loadWallet(homeDir?: string): WalletFile | null {
  const path = walletPath(homeDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as WalletFile;
}
