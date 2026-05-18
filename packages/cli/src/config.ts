import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "@smartclaws/core/types";

export type { Config };

const DEFAULT_CONFIG: Config = {
  version: 1,
  network: "",
  chainId: 0,
  rpcUrl: "",
  contractAddress: "",
  deviceGroupAddress: "",
};

export function getConfigDir(): string {
  return process.env.SMARTCLAWS_HOME || join(homedir(), ".smartclaws");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const walletsDir = join(dir, "wallets");
  if (!existsSync(walletsDir)) mkdirSync(walletsDir, { recursive: true });

  const devicesDir = join(dir, "devices");
  if (!existsSync(devicesDir)) mkdirSync(devicesDir, { recursive: true });

  const agentsDir = join(dir, "agents");
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
}

export function loadConfig(): Config | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Config;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

export function createDefaultConfig(
  network: string,
  rpcUrl: string,
  chainId: number,
  contractAddress: string,
): Config {
  return { ...DEFAULT_CONFIG, network, rpcUrl, chainId, contractAddress };
}
