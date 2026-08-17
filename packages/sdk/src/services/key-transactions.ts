import type { Config, WalletFile } from "@smartclaws/core/types";
import type { Address, Hex } from "viem";
import {
    getClients,
    getPublicClient,
    getPublicKeyRegistryContract,
    resolvePublicKeyRegistryAddress,
} from "../contracts.js";
import { SmartClawsError } from "../errors.js";
import { requireSuccessfulReceipt } from "../receipts.js";
import {
    getPublicKey,
    hasPublicKey,
    publicKeyFingerprint,
    publicKeyFromPrivateKey,
    publicKeyMatches,
    registerPublicKey,
    type Secp256k1PublicKey,
    viewingPrivateKey,
} from "./keys.js";

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
    fingerprint: string;
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
    const fingerprint = publicKeyFingerprint(localPublicKey);

    if (!(await hasPublicKey(client, registry, account))) {
        return {
            account,
            registry,
            registered: false,
            matchesViewKey: false,
            usesSigningKey,
            localPublicKey,
            fingerprint,
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
        fingerprint,
    };
}

export interface ViewKeyTransactionResult {
    registry: Address;
    account: Address;
    txHash: Hex;
    status: "success";
    fingerprint: string;
    matchesViewKey: boolean;
    registered: boolean;
}

export async function registerActiveViewKey(
    config: Config,
    wallet: WalletFile,
): Promise<ViewKeyTransactionResult> {
    const account = wallet.address as Address;
    const registry = await resolvePublicKeyRegistryAddress(config);
    const { walletClient, publicClient } = getClients(config, wallet);
    const localKey = publicKeyFromPrivateKey(viewingPrivateKey(wallet));
    const hash = await registerPublicKey(walletClient, registry, localKey);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "registerPublicKey");

    const status = await getViewKeyStatus(config, wallet);
    if (!status.registered || !status.matchesViewKey) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Viewing-key registration confirmed, but the on-chain key does not match the local viewing key.",
            { txHash: hash, registry, account, fingerprint: status.fingerprint },
        );
    }
    return {
        registry,
        account,
        txHash: hash,
        status: "success",
        fingerprint: status.fingerprint,
        matchesViewKey: true,
        registered: true,
    };
}

export async function removeRegisteredPublicKey(
    config: Config,
    wallet: WalletFile,
): Promise<ViewKeyTransactionResult> {
    const account = wallet.address as Address;
    const registry = await resolvePublicKeyRegistryAddress(config);
    const { publicClient } = getClients(config, wallet);
    if (!(await hasPublicKey(publicClient, registry, account))) {
        throw new SmartClawsError("NO_PUBLIC_KEY", "Account has no registered public key", {
            account,
            registry,
        });
    }
    const contract = getPublicKeyRegistryContract(registry, config, wallet);
    const hash = await contract.write.removePublicKey();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    requireSuccessfulReceipt(receipt, hash, "removePublicKey");

    if (await hasPublicKey(publicClient, registry, account)) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Public-key removal confirmed, but the registry still has a key for this account.",
            { txHash: hash, registry, account },
        );
    }
    const localKey = publicKeyFromPrivateKey(viewingPrivateKey(wallet));
    return {
        registry,
        account,
        txHash: hash,
        status: "success",
        fingerprint: publicKeyFingerprint(localKey),
        matchesViewKey: false,
        registered: false,
    };
}
