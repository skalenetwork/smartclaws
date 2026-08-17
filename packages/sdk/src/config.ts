import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, SmartClawsMode, WalletFile } from "@smartclaws/core/types";
import { SmartClawsError } from "./errors.js";
import { atomicWriteJson } from "./fs.js";

export type { Config, SmartClawsMode };

/** The only config version this build can load. Older files are reset, never migrated. */
export const CURRENT_CONFIG_VERSION = 3;

const DEFAULT_MODE: SmartClawsMode = "controller";

const DEFAULT_CONFIG: Config = {
    version: 3,
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

function requireCurrentConfig(raw: unknown): Config {
    if (!raw || typeof raw !== "object") {
        throw new SmartClawsError(
            "CONFIG_VERSION_UNSUPPORTED",
            "SmartClaws config is unreadable. Re-run smartclaws init to re-create this HOME.",
        );
    }
    const maybe = raw as { version?: unknown };
    if (maybe.version === CURRENT_CONFIG_VERSION) return maybe as Config;
    // Deliberately distinct from NOT_INITIALIZED: the HOME exists and holds a wallet worth
    // preserving, so callers must route the user to `init`'s reset path rather than to a
    // "you have nothing here" message.
    throw new SmartClawsError(
        "CONFIG_VERSION_UNSUPPORTED",
        `This SmartClaws HOME uses config version ${String(maybe.version ?? "unknown")}, which cannot be migrated. Re-run smartclaws init to re-create it.`,
        { version: maybe.version, expected: CURRENT_CONFIG_VERSION },
    );
}

export function loadConfig(homeDir?: string): Config | null {
    const path = getConfigPath(homeDir);
    if (!existsSync(path)) return null;
    return requireCurrentConfig(JSON.parse(readFileSync(path, "utf-8")));
}

/**
 * The few fields worth carrying across a HOME reset. Everything deployment-bound is
 * deliberately absent: the registry address and the attached group/agent/device
 * addresses all name contracts from the superseded deployment, and re-using any of
 * them would leave a current config pointing at dead entities.
 */
export interface StaleConfigHints {
    /** On-disk version, or null when the file could not be parsed. */
    version: number | null;
    mode?: SmartClawsMode;
    network?: string;
    rpcUrl?: string;
    chainId?: number;
}

function isMode(value: unknown): value is SmartClawsMode {
    return value === "controller" || value === "bridge-agent" || value === "master-agent";
}

/**
 * Read a config file that {@link loadConfig} refuses, returning only the local
 * preferences that survive a reset. Returns null when there is no config file or the
 * config is already current — so a non-null result means "this HOME must be reset".
 */
export function readStaleConfigHints(homeDir?: string): StaleConfigHints | null {
    const path = getConfigPath(homeDir);
    if (!existsSync(path)) return null;

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
        return { version: null };
    }
    if (!raw || typeof raw !== "object") return { version: null };

    const maybe = raw as Record<string, unknown>;
    if (maybe.version === CURRENT_CONFIG_VERSION) return null;

    return {
        version: typeof maybe.version === "number" ? maybe.version : null,
        mode: isMode(maybe.mode) ? maybe.mode : undefined,
        network: typeof maybe.network === "string" ? maybe.network : undefined,
        rpcUrl: typeof maybe.rpcUrl === "string" ? maybe.rpcUrl : undefined,
        chainId: typeof maybe.chainId === "number" ? maybe.chainId : undefined,
    };
}

export function saveConfig(config: Config, homeDir?: string): void {
    ensureConfigDir(homeDir);
    atomicWriteJson(getConfigPath(homeDir), { ...DEFAULT_CONFIG, ...config, version: 3 });
}

/** Load a current config, or null when missing or unloadable (stale/unreadable). */
export function tryLoadConfig(homeDir?: string): Config | null {
    try {
        return loadConfig(homeDir);
    } catch {
        return null;
    }
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
