import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureConfigDir, getConfigDir } from "./config.ts";

export interface WalletFile {
  address: string;
  privateKey: string;
}

function walletPath(): string {
  return join(getConfigDir(), "wallets", "default.json");
}

export function generateWallet(): WalletFile {
  ensureConfigDir();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: WalletFile = { address: account.address, privateKey };
  writeFileSync(walletPath(), `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return wallet;
}

export function loadWallet(): WalletFile | null {
  const path = walletPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as WalletFile;
}
