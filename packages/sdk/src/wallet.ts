import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WalletFile } from "@smartclaws/core/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureConfigDir, getConfigDir } from "./config.js";

export type { WalletFile };

function walletPath(homeDir?: string): string {
  return join(getConfigDir(homeDir), "wallets", "default.json");
}

export function saveWallet(wallet: WalletFile, homeDir?: string): WalletFile {
  ensureConfigDir(homeDir);
  writeFileSync(walletPath(homeDir), `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return wallet;
}

export function walletFromPrivateKey(privateKey: string): WalletFile {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalized as never);
  return { address: account.address, privateKey: normalized };
}

export function generateWallet(homeDir?: string): WalletFile {
  const privateKey = generatePrivateKey();
  return saveWallet(walletFromPrivateKey(privateKey), homeDir);
}

export function importWallet(privateKey: string, homeDir?: string): WalletFile {
  return saveWallet(walletFromPrivateKey(privateKey), homeDir);
}

export function loadWallet(homeDir?: string): WalletFile | null {
  const path = walletPath(homeDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as WalletFile;
}
