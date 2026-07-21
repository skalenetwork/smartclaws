import { getNetwork } from "@smartclaws/core/networks";
import {
  type Config,
  createDefaultConfig,
  loadConfig,
  loadWallet,
  SmartClawsError,
  type WalletFile,
} from "@smartclaws/sdk";
import { type Static, Type } from "typebox";

export const ConfigSchema = Type.Object({
  smartclawsHome: Type.Optional(
    Type.String({
      description: "SmartClaws config directory. Defaults to SMARTCLAWS_HOME or ~/.smartclaws.",
    }),
  ),
  network: Type.Optional(
    Type.String({ description: "Default network name. Currently supported: base-testnet." }),
  ),
  rpcUrl: Type.Optional(Type.String({ description: "Override RPC URL." })),
  chainId: Type.Optional(
    Type.Number({
      description: "Override chain ID (required with rpcUrl when no network is set).",
    }),
  ),
  registryAddress: Type.Optional(
    Type.String({ description: "Override registry contract address." }),
  ),
});

export type PluginConfig = Static<typeof ConfigSchema>;

/**
 * Resolve a SmartClaws `Config` from plugin config. Prefers an existing
 * `smartclaws init` config file (under `smartclawsHome`), then applies any
 * plugin-config overrides. If no config file exists, a `network` (or
 * `rpcUrl` + `chainId`) in plugin config bootstraps one. Never mutates
 * `process.env`; the home directory is passed explicitly to the SDK.
 */
export function resolveConfig(pc: PluginConfig): Config {
  let cfg = loadConfig(pc.smartclawsHome);
  if (!cfg) {
    if (pc.network) {
      const net = getNetwork(pc.network);
      cfg = createDefaultConfig(
        pc.network,
        pc.rpcUrl ?? net.rpcUrl,
        pc.chainId ?? net.chainId,
        pc.registryAddress ?? net.registryAddress,
      );
    } else if (pc.rpcUrl && pc.chainId !== undefined) {
      cfg = createDefaultConfig("", pc.rpcUrl, pc.chainId, pc.registryAddress ?? "");
    } else {
      throw new SmartClawsError(
        "NOT_INITIALIZED",
        "SmartClaws is not initialized. Run `smartclaws init`, or set `network` (or `rpcUrl` + `chainId`) in the plugin config.",
      );
    }
  }

  if (pc.network) cfg.network = pc.network;
  if (pc.rpcUrl) cfg.rpcUrl = pc.rpcUrl;
  if (pc.chainId !== undefined) cfg.chainId = pc.chainId;
  if (pc.registryAddress) cfg.contractAddress = pc.registryAddress;
  return cfg;
}

/** Load the wallet, throwing a typed error when none is configured. */
export function requireWallet(homeDir?: string): WalletFile {
  const wallet = loadWallet(homeDir);
  if (!wallet) {
    throw new SmartClawsError("NO_WALLET", "No SmartClaws wallet found. Run `smartclaws init`.");
  }
  return wallet;
}
