import { homedir } from "node:os";
import { join } from "node:path";
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

export const HARD_MAX_DISCOVERY_PAGE = 100;
export const HARD_MAX_SYNC_ENTITIES = 1000;
export const HARD_MAX_READ_MESSAGES = 100;
export const DEFAULT_READ_MESSAGES = 10;
export const DEFAULT_DISCOVERY_PAGE = 50;
export const DEFAULT_ACCESS_LIMIT = 20;
export const HARD_MAX_ACCESS_LIMIT = 50;
export const ACCESS_CONCURRENCY = 4;
export const HARD_MAX_CHANNEL_CAPACITY_BYTES = 16 * 1024 * 1024;

export const ConfigSchema = Type.Object({
    smartclawsHome: Type.Optional(
        Type.String({
            description:
                "SmartClaws config directory. Defaults to SMARTCLAWS_HOME or ~/.smartclaws.",
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
    allowPrivateRpc: Type.Optional(
        Type.Boolean({
            description:
                "Allow custom RPC URLs that target loopback, private, link-local, or metadata hosts. Default false.",
        }),
    ),
    maxDiscoveryPageSize: Type.Optional(
        Type.Number({
            description: `Maximum discovery page size (hard ceiling ${HARD_MAX_DISCOVERY_PAGE}).`,
        }),
    ),
    maxSyncEntities: Type.Optional(
        Type.Number({
            description: `Maximum entities a sync may hydrate (hard ceiling ${HARD_MAX_SYNC_ENTITIES}).`,
        }),
    ),
    maxReadMessages: Type.Optional(
        Type.Number({
            description: `Maximum messages a read may return (hard ceiling ${HARD_MAX_READ_MESSAGES}).`,
        }),
    ),
    maxChannelCapacityBytes: Type.Optional(
        Type.String({
            description: `Maximum channel capacity for registration, as a decimal string (hard ceiling ${HARD_MAX_CHANNEL_CAPACITY_BYTES}).`,
        }),
    ),
});

export type PluginConfig = Static<typeof ConfigSchema>;

function clampLimit(value: number | undefined, fallback: number, hardMax: number): number {
    const resolved = value === undefined ? fallback : value;
    if (!Number.isSafeInteger(resolved) || resolved < 1) return fallback;
    return Math.min(resolved, hardMax);
}

export function resolvedHome(pc: PluginConfig): string {
    return pc.smartclawsHome ?? process.env.SMARTCLAWS_HOME ?? join(homedir(), ".smartclaws");
}

export function discoveryPageLimit(pc: PluginConfig, requested?: number): number {
    const max = clampLimit(
        pc.maxDiscoveryPageSize,
        DEFAULT_DISCOVERY_PAGE,
        HARD_MAX_DISCOVERY_PAGE,
    );
    if (requested === undefined) return max;
    return clampLimit(requested, max, max);
}

export function readMessageLimit(pc: PluginConfig, requested?: number): number {
    const max = clampLimit(pc.maxReadMessages, DEFAULT_READ_MESSAGES, HARD_MAX_READ_MESSAGES);
    if (requested === undefined) return DEFAULT_READ_MESSAGES > max ? max : DEFAULT_READ_MESSAGES;
    return clampLimit(requested, max, max);
}

export function accessPageLimit(pc: PluginConfig, requested?: number): number {
    const max = Math.min(
        clampLimit(pc.maxDiscoveryPageSize, DEFAULT_ACCESS_LIMIT, HARD_MAX_ACCESS_LIMIT),
        HARD_MAX_ACCESS_LIMIT,
    );
    if (requested === undefined) return DEFAULT_ACCESS_LIMIT > max ? max : DEFAULT_ACCESS_LIMIT;
    return clampLimit(requested, max, max);
}

export function maxSyncEntities(pc: PluginConfig): number {
    return clampLimit(pc.maxSyncEntities, HARD_MAX_SYNC_ENTITIES, HARD_MAX_SYNC_ENTITIES);
}

export function maxChannelCapacityBytes(pc: PluginConfig): bigint {
    const raw = pc.maxChannelCapacityBytes;
    if (!raw) return BigInt(HARD_MAX_CHANNEL_CAPACITY_BYTES);
    try {
        const value = BigInt(raw);
        if (value <= 0n) return BigInt(HARD_MAX_CHANNEL_CAPACITY_BYTES);
        return value > BigInt(HARD_MAX_CHANNEL_CAPACITY_BYTES)
            ? BigInt(HARD_MAX_CHANNEL_CAPACITY_BYTES)
            : value;
    } catch {
        return BigInt(HARD_MAX_CHANNEL_CAPACITY_BYTES);
    }
}

export function setupOverrides(pc: PluginConfig) {
    return {
        network: pc.network,
        rpcUrl: pc.rpcUrl,
        chainId: pc.chainId,
        registryAddress: pc.registryAddress,
    };
}

/**
 * Resolve a SmartClaws `Config` from plugin config. Prefers an existing
 * HOME config file, then applies plugin-config overrides. Never mutates
 * `process.env`; the home directory is passed explicitly to the SDK.
 */
export function resolveConfig(pc: PluginConfig): Config {
    const home = resolvedHome(pc);
    let cfg = loadConfig(home);
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
                "SmartClaws is not initialized. Use smartclaws_setup_status, then smartclaws_initialize.",
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
export function requireWallet(pc: PluginConfig): WalletFile {
    const wallet = loadWallet(resolvedHome(pc));
    if (!wallet) {
        throw new SmartClawsError(
            "NO_WALLET",
            "No SmartClaws wallet found. Use smartclaws_setup_status, then smartclaws_initialize.",
        );
    }
    return wallet;
}
