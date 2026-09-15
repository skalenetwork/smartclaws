import { secp256k1 } from "@noble/curves/secp256k1";
import { type Address, bytesToHex, type Hex, hexToBytes, keccak256, numberToBytes } from "viem";
import { decryptEcies } from "./ecies";
import { vaultRead, vaultRemove, vaultWrite } from "./session-vault";

/**
 * This tab's viewing key: the secp256k1 key whose public half the wallet registers in
 * PublicKeyRegistry, and which `requestMessages` re-encrypts disclosures to.
 *
 * DEMO ONLY — see session-vault.ts for what the at-rest protection does and does not cover.
 * The private scalar never leaves this module: components get the public key and a
 * `decrypt` capability, never the key itself.
 */

export interface PublicKeyCoordinates {
    x: Hex;
    y: Hex;
}

export interface ViewKeySnapshot {
    owner: Address;
    publicKey: PublicKeyCoordinates;
}

export function viewKeyMessage(params: { owner: Address; chainId: number; registry: Address }) {
    return [
        "SmartClaws dashboard: create a viewing key",
        "",
        "Signing derives a key that lets this browser tab decrypt SmartClaws messages disclosed to your wallet. It is not a transaction and cannot move funds.",
        "",
        "Only sign this on the SmartClaws dashboard. Anyone holding this signature can read what is disclosed to you.",
        "",
        `Wallet: ${params.owner}`,
        `Chain ID: ${params.chainId}`,
        `Key registry: ${params.registry}`,
    ].join("\n");
}

// Wallets sign personal messages deterministically (RFC 6979), so one wallet derives the
// same key in every tab and registers it once. A wallet that signs non-deterministically
// derives a new key each time; the dashboard then reports a mismatch and offers to replace.
function deriveKey(signature: Hex): Uint8Array {
    const order = secp256k1.CURVE.n;
    const scalar = (BigInt(keccak256(signature)) % (order - 1n)) + 1n;
    return numberToBytes(scalar, { size: 32 });
}

function coordinates(key: Uint8Array): PublicKeyCoordinates {
    const point = secp256k1.getPublicKey(key, false);
    return { x: bytesToHex(point.slice(1, 33)), y: bytesToHex(point.slice(33, 65)) };
}

export function samePublicKey(a: PublicKeyCoordinates, b: PublicKeyCoordinates) {
    return a.x.toLowerCase() === b.x.toLowerCase() && a.y.toLowerCase() === b.y.toLowerCase();
}

let privateKey: Uint8Array | null = null;
let snapshot: ViewKeySnapshot | null = null;
const listeners = new Set<() => void>();

const vaultName = (owner: Address) => `view-key:${owner.toLowerCase()}`;
const isOwner = (owner: Address) => snapshot?.owner.toLowerCase() === owner.toLowerCase();

function set(owner: Address | null, key: Uint8Array | null) {
    privateKey = key;
    snapshot = owner && key ? { owner, publicKey: coordinates(key) } : null;
    for (const listener of listeners) listener();
}

export const viewKey = {
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    getSnapshot(): ViewKeySnapshot | null {
        return snapshot;
    },

    /** Derives the key from a signature over `viewKeyMessage` and seals it into the vault. */
    async adopt(owner: Address, signature: Hex) {
        const key = deriveKey(signature);
        await vaultWrite(vaultName(owner), bytesToHex(key));
        set(owner, key);
    },

    /** Picks up a key this tab already derived, e.g. after a refresh. */
    async restore(owner: Address) {
        if (isOwner(owner)) return;
        const stored = await vaultRead<Hex>(vaultName(owner));
        set(stored ? owner : null, stored ? hexToBytes(stored) : null);
    },

    forget(owner: Address) {
        vaultRemove(vaultName(owner));
        if (isOwner(owner)) set(null, null);
    },

    decrypt(owner: Address, payload: Hex): Promise<Uint8Array> {
        if (!privateKey || !isOwner(owner)) {
            return Promise.reject(new Error("No viewing key for this wallet in this tab"));
        }
        return decryptEcies(privateKey, payload);
    },
};
