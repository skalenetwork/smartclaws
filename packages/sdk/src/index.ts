// Provider-agnostic SmartClaws service layer. Consumed by the CLI and by
// per-provider plugins (OpenClaw, etc.). No CLI, OpenClaw, or presentation
// dependencies live here — keep it that way so any provider can reuse it.

import type { Config, WalletFile } from "@smartclaws/core/types";
import type { Address, Hex } from "viem";
import { getClients, getPublicClient, resolvePublicKeyRegistryAddress } from "./contracts.js";
import { type CtxClient, waitForCtxReceipts } from "./services/ctx.js";
import {
    BiteEncryptionProvider,
    type EncryptionProvider,
    encryptForChannel,
} from "./services/encryption.js";
import {
    getPublicKey,
    hasPublicKey,
    publicKeyFromPrivateKey,
    publicKeyMatches,
    registerPublicKey,
    type Secp256k1PublicKey,
    viewingPrivateKey,
} from "./services/keys.js";

// Convenience re-exports of core primitives
export type {
    AgentFile,
    Config,
    DeviceFile,
    GroupFile,
    SmartClawsMode,
    WalletFile,
} from "@smartclaws/core/types";
export * from "./agent.js";
export * from "./backup.js";
export * from "./client.js";
// Config / wallet / local records / contract clients
export * from "./config.js";
export * from "./contracts.js";
export * from "./device.js";
// Typed errors
export * from "./errors.js";
export * from "./group.js";
export * from "./services/channels.js";
export * from "./services/ctx.js";
export * from "./services/discovery.js";
export * from "./services/encryption.js";
export * from "./services/keys.js";
export * from "./services/readers.js";
// Services (typed params in, structured data out)
export * from "./services/wallet.js";
export * from "./wallet.js";

export function createEncryptionProvider(config: Pick<Config, "rpcUrl">): EncryptionProvider {
    return new BiteEncryptionProvider(config.rpcUrl);
}

export async function encryptForChannelWithConfig(
    config: Pick<Config, "rpcUrl">,
    envelope: Hex | Uint8Array,
    publisherWallet: Address,
    channelAddress: Address,
): Promise<Hex> {
    return encryptForChannel(
        createEncryptionProvider(config),
        envelope,
        publisherWallet,
        channelAddress,
    );
}

export async function waitForCtxReceiptsWithConfig(config: Config, originHash: Hex) {
    return waitForCtxReceipts(getPublicClient(config) as CtxClient, originHash);
}

export async function hasPublicKeyWithConfig(config: Config, account: Address): Promise<boolean> {
    const registry = await resolvePublicKeyRegistryAddress(config);
    return hasPublicKey(getPublicClient(config), registry, account);
}

export async function getPublicKeyWithConfig(
    config: Config,
    account: Address,
): Promise<Secp256k1PublicKey> {
    const registry = await resolvePublicKeyRegistryAddress(config);
    return getPublicKey(getPublicClient(config), registry, account);
}

export async function registerPublicKeyWithConfig(
    config: Config,
    wallet: WalletFile,
): Promise<Hex> {
    const registry = await resolvePublicKeyRegistryAddress(config);
    const { walletClient } = getClients(config, wallet);
    // The viewing key, not the signing key: this must match whatever discloseMessages
    // decrypts with, or the fee is spent on a payload the wallet cannot open.
    return registerPublicKey(
        walletClient,
        registry,
        publicKeyFromPrivateKey(viewingPrivateKey(wallet)),
    );
}

export interface ViewKeyStatus {
    account: Address;
    registry: Address;
    registered: boolean;
    /** Whether the registered key is the one this wallet's viewing key can open. */
    matchesViewKey: boolean;
    /** False once a separate viewing key is configured. */
    usesSigningKey: boolean;
    localPublicKey: Secp256k1PublicKey;
    registeredPublicKey?: Secp256k1PublicKey;
}

/**
 * Whether this wallet can actually read what it pays to disclose.
 *
 * A mismatch is recoverable — register the right key and request again — but it is only
 * visible before spending if something asks. Nothing on the paid path can check it for you:
 * `requestMessages` snapshots whatever is registered, and the ECIES here has no MAC, so a
 * wrong key surfaces as "not a valid envelope" rather than "wrong key".
 */
export async function getViewKeyStatus(config: Config, wallet: WalletFile): Promise<ViewKeyStatus> {
    const account = wallet.address as Address;
    const registry = await resolvePublicKeyRegistryAddress(config);
    const client = getPublicClient(config);
    const viewKey = viewingPrivateKey(wallet);
    const localPublicKey = publicKeyFromPrivateKey(viewKey);
    const usesSigningKey = wallet.viewPrivateKey === undefined;

    if (!(await hasPublicKey(client, registry, account))) {
        return {
            account,
            registry,
            registered: false,
            matchesViewKey: false,
            usesSigningKey,
            localPublicKey,
        };
    }
    const registeredPublicKey = await getPublicKey(client, registry, account);
    return {
        account,
        registry,
        registered: true,
        matchesViewKey: publicKeyMatches(registeredPublicKey, viewKey),
        usesSigningKey,
        localPublicKey,
        registeredPublicKey,
    };
}
