import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureConfigDir, getConfigDir } from "./config.ts";

export interface WalletFile {
  address: string;
  privateKey: string;
}

function walletsDir(): string {
  return join(getConfigDir(), "wallets");
}

function walletPath(name: string): string {
  return join(walletsDir(), `${name}.json`);
}

export function generateWallet(name = "default"): WalletFile {
  ensureConfigDir();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: WalletFile = { address: account.address, privateKey };
  writeFileSync(walletPath(name), `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return wallet;
}

export function loadWallet(name = "default"): WalletFile | null {
  const path = walletPath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as WalletFile;
}

export function walletExists(name = "default"): boolean {
  return existsSync(walletPath(name));
}

export function listWallets(): string[] {
  const dir = walletsDir();
  if (!existsSync(dir)) return [];
  return (readdirSync(dir) as string[])
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""));
}
