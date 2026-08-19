import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WalletFile } from "@smartclaws/core/types";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureConfigDir, getConfigDir } from "./config.js";
import { SmartClawsError } from "./errors.js";
import { atomicWriteJson } from "./fs.js";
import { publicKeyFromPrivateKey } from "./services/keys.js";

export type { WalletFile };

function walletPath(homeDir?: string): string {
    return join(getConfigDir(homeDir), "wallets", "default.json");
}

export function saveWallet(wallet: WalletFile, homeDir?: string): WalletFile {
    ensureConfigDir(homeDir);
    atomicWriteJson(walletPath(homeDir), wallet, 0o600);
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

function requireWalletFile(homeDir?: string): WalletFile {
    const wallet = loadWallet(homeDir);
    if (!wallet) {
        throw new SmartClawsError("NO_WALLET", "No wallet in this SmartClaws HOME.");
    }
    return wallet;
}

function normalizePrivateKey(privateKey: string): string {
    const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    // publicKeyFromPrivateKey rejects anything outside the secp256k1 scalar range, so an
    // unusable view key is caught here rather than at disclosure time, after paying.
    publicKeyFromPrivateKey(normalized as Hex);
    return normalized;
}

/**
 * Store a viewing key. Lives in the wallet file so the `init` reset path, which salvages
 * exactly that file, carries it across a HOME re-creation.
 */
export function setViewKey(privateKey: string, homeDir?: string): WalletFile {
    const wallet = requireWalletFile(homeDir);
    return saveWallet({ ...wallet, viewPrivateKey: normalizePrivateKey(privateKey) }, homeDir);
}

export function generateViewKey(homeDir?: string): WalletFile {
    return setViewKey(generatePrivateKey(), homeDir);
}

/** Drop the viewing key. Disclose and register fail until a new one is generated. */
export function removeViewKey(homeDir?: string): WalletFile {
    const { viewPrivateKey: _dropped, ...rest } = requireWalletFile(homeDir);
    return saveWallet(rest, homeDir);
}
