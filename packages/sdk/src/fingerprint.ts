import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_CONFIG_VERSION, getConfigDir, tryLoadConfig } from "./config.js";
import { SmartClawsError } from "./errors.js";
import { redactRpcUrl } from "./rpc.js";
import {
    publicKeyFingerprint,
    publicKeyFromPrivateKey,
    viewingPrivateKey,
} from "./services/keys.js";
import { loadWallet } from "./wallet.js";

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
    return JSON.stringify(value);
}

function viewKeyPublicFingerprint(wallet: ReturnType<typeof loadWallet>): string | null {
    if (!wallet) return null;
    try {
        return publicKeyFingerprint(publicKeyFromPrivateKey(viewingPrivateKey(wallet)));
    } catch {
        return "invalid";
    }
}

export interface HomeFingerprintSnapshot {
    configVersion: number | null;
    staleConfig: boolean;
    walletAddress: string | null;
    hasSeparateViewKey: boolean;
    viewKeyFingerprint: string | null;
    network: string;
    chainId: number;
    registry: string;
    rpcUrl: string;
    mode: string;
    attachedGroup: string;
    attachedAgent: string;
    attachedDevices: string[];
}

function readConfigVersion(homeDir?: string): {
    configVersion: number | null;
    configExists: boolean;
} {
    const path = join(getConfigDir(homeDir), "config.json");
    if (!existsSync(path)) return { configVersion: null, configExists: false };
    try {
        const raw = JSON.parse(readFileSync(path, "utf-8")) as { version?: number };
        return {
            configVersion: typeof raw.version === "number" ? raw.version : null,
            configExists: true,
        };
    } catch {
        return { configVersion: null, configExists: true };
    }
}

export function homeFingerprintSnapshot(homeDir?: string): HomeFingerprintSnapshot {
    const { configVersion, configExists } = readConfigVersion(homeDir);
    const config = tryLoadConfig(homeDir);
    const wallet = loadWallet(homeDir);
    return {
        configVersion,
        staleConfig: configExists && configVersion !== CURRENT_CONFIG_VERSION,
        walletAddress: wallet?.address ?? config?.walletAddress ?? null,
        hasSeparateViewKey: wallet?.viewPrivateKey !== undefined,
        viewKeyFingerprint: viewKeyPublicFingerprint(wallet),
        network: config?.network ?? "",
        chainId: config?.chainId ?? 0,
        registry: config?.contractAddress ?? "",
        rpcUrl: redactRpcUrl(config?.rpcUrl ?? ""),
        mode: config?.mode ?? "",
        attachedGroup: config?.attachedGroupAddress ?? "",
        attachedAgent: config?.attachedAgentAddress ?? "",
        attachedDevices: [...(config?.attachedDeviceAddresses ?? [])]
            .map((address) => address.toLowerCase())
            .sort(),
    };
}

/** Public HOME identity hash. Never includes private keys, paths, or raw credentials. */
export function homeFingerprint(homeDir?: string): string {
    const config = tryLoadConfig(homeDir);
    const wallet = loadWallet(homeDir);
    return sha256Hex(
        canonical({
            ...homeFingerprintSnapshot(homeDir),
            // The public snapshot stays credential-free, while the final opaque
            // digest still changes for every raw RPC URL change.
            rpcUrlDigest: sha256Hex(config?.rpcUrl ?? ""),
            // Invalid legacy wallet material must not make status unavailable;
            // its opaque digest still participates in stale-state detection.
            viewKeyDigest: sha256Hex(wallet ? viewingPrivateKey(wallet) : ""),
        }),
    );
}

export function requireHomeFingerprint(homeDir: string | undefined, expected: string): void {
    const actual = homeFingerprint(homeDir);
    if (actual === expected) return;
    throw new SmartClawsError(
        "STATE_CHANGED",
        "SmartClaws HOME state changed since the expected fingerprint was taken. Re-read status and retry.",
        { expected, actual },
    );
}

export function backupFingerprint(info: {
    name: string;
    createdAt: number;
    sizeBytes: number;
}): string {
    return sha256Hex(
        canonical({
            name: info.name,
            createdAt: Math.round(info.createdAt),
            sizeBytes: info.sizeBytes,
        }),
    );
}

export function candidateSetFingerprint(
    backups: Array<{ name: string; createdAt: number; sizeBytes: number }>,
): string {
    const fingerprints = [...backups]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((item) => backupFingerprint(item));
    return sha256Hex(canonical(fingerprints));
}
