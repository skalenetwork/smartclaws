import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, LegacyConfigV1, SmartClawsMode, WalletFile } from "@smartclaws/core/types";
import { SmartClawsError } from "./errors.js";

export type { Config, SmartClawsMode };

const DEFAULT_MODE: SmartClawsMode = "controller";

const DEFAULT_CONFIG: Config = {
  version: 2,
  network: "",
  chainId: 0,
  rpcUrl: "",
  contractAddress: "",
  walletAddress: "",
  mode: DEFAULT_MODE,
  deviceGroupAddress: "",
  attachedGroupAddress: "",
  attachedAgentAddress: "",
  attachedDeviceAddresses: [],
};

export function getConfigDir(homeDir?: string): string {
  return homeDir || process.env.SMARTCLAWS_HOME || join(homedir(), ".smartclaws");
}

export function getConfigPath(homeDir?: string): string {
  return join(getConfigDir(homeDir), "config.json");
}

export function ensureConfigDir(homeDir?: string): void {
  const dir = getConfigDir(homeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const child of ["wallets", "groups", "devices", "agents", "cache"]) {
    const childDir = join(dir, child);
    if (!existsSync(childDir)) mkdirSync(childDir, { recursive: true });
  }
}

function migrateConfig(raw: unknown): Config {
  const maybe = raw as Partial<Config> & Partial<LegacyConfigV1>;
  if (maybe.version === 2) {
    return {
      ...DEFAULT_CONFIG,
      ...maybe,
      attachedDeviceAddresses: Array.isArray(maybe.attachedDeviceAddresses)
        ? maybe.attachedDeviceAddresses
        : [],
    } as Config;
  }

  const legacy = maybe as LegacyConfigV1;
  return {
    ...DEFAULT_CONFIG,
    network: legacy.network ?? "",
    chainId: legacy.chainId ?? 0,
    rpcUrl: legacy.rpcUrl ?? "",
    contractAddress: legacy.contractAddress ?? "",
    deviceGroupAddress: legacy.deviceGroupAddress ?? "",
    attachedGroupAddress: legacy.deviceGroupAddress ?? "",
  };
}

export function loadConfig(homeDir?: string): Config | null {
  const path = getConfigPath(homeDir);
  if (!existsSync(path)) return null;
  return migrateConfig(JSON.parse(readFileSync(path, "utf-8")));
}

export function saveConfig(config: Config, homeDir?: string): void {
  ensureConfigDir(homeDir);
  writeFileSync(
    getConfigPath(homeDir),
    `${JSON.stringify({ ...DEFAULT_CONFIG, ...config }, null, 2)}\n`,
  );
}

export function createDefaultConfig(
  network: string,
  rpcUrl: string,
  chainId: number,
  contractAddress: string,
  mode: SmartClawsMode = DEFAULT_MODE,
  walletAddress = "",
): Config {
  return { ...DEFAULT_CONFIG, network, rpcUrl, chainId, contractAddress, mode, walletAddress };
}

export function assertHomeWallet(config: Config, wallet: WalletFile): void {
  if (!config.walletAddress) return;
  if (config.walletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new SmartClawsError(
      "HOME_WALLET_MISMATCH",
      `This SmartClaws HOME belongs to ${config.walletAddress}, but the loaded wallet is ${wallet.address}.`,
      { configWallet: config.walletAddress, wallet: wallet.address },
    );
  }
}
