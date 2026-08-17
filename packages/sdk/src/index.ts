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
    registerPublicKey,
    type Secp256k1PublicKey,
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
    return registerPublicKey(
        walletClient,
        registry,
        publicKeyFromPrivateKey(wallet.privateKey as Hex),
    );
}
