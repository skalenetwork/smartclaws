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

/**
 * Resolve the SmartClaws home directory. An explicit `homeDir` (e.g. from a
 * plugin's config) always wins; otherwise fall back to `SMARTCLAWS_HOME`, then
 * `~/.smartclaws`. Passing `homeDir` explicitly lets callers avoid mutating
 * `process.env`, so concurrent callers can use different homes safely.
 */
export function getConfigDir(homeDir?: string): string {
  return homeDir || process.env.SMARTCLAWS_HOME || join(homedir(), ".smartclaws");
}

export function getConfigPath(homeDir?: string): string {
  return join(getConfigDir(homeDir), "config.json");
}

export function ensureConfigDir(homeDir?: string): void {
  const dir = getConfigDir(homeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const walletsDir = join(dir, "wallets");
  if (!existsSync(walletsDir)) mkdirSync(walletsDir, { recursive: true });

  const devicesDir = join(dir, "devices");
  if (!existsSync(devicesDir)) mkdirSync(devicesDir, { recursive: true });

  const agentsDir = join(dir, "agents");
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
}

export function loadConfig(homeDir?: string): Config | null {
  const path = getConfigPath(homeDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Config;
}

export function saveConfig(config: Config, homeDir?: string): void {
  ensureConfigDir(homeDir);
  writeFileSync(getConfigPath(homeDir), `${JSON.stringify(config, null, 2)}\n`);
}

export function createDefaultConfig(
  network: string,
  rpcUrl: string,
  chainId: number,
  contractAddress: string,
): Config {
  return { ...DEFAULT_CONFIG, network, rpcUrl, chainId, contractAddress };
}
