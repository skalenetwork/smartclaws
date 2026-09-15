import { decode, type Envelope } from "@smartclaws/core/envelope";
import type { Address, Hex } from "viem";
import { chain } from "@/config/wagmi";
import { vaultRead, vaultRemove, vaultWrite } from "./session-vault";
import { viewKey } from "./view-key";

/**
 * What this tab has learned with the viewing key: messages it decrypted, and the disclosure
 * attempts it saw fail. Kept per wallet in the session vault, so a refresh keeps them and
 * closing the tab (or disconnecting) drops them.
 */

export interface DecryptedMessage {
    channel: Address;
    offset: number;
    /** Null when the plaintext is not a SmartClaws envelope; `text` still holds it. */
    envelope: Envelope | null;
    text: string;
    /** The transaction that emitted the disclosure. */
    txHash: Hex;
    decryptedAt: number;
}

export interface LocalAttempt {
    txHash: Hex;
    channel: Address;
    reader: Address;
    offset: number;
    /** `request`: `requestMessages` reverted. `callback`: the CTX callback reverted. */
    stage: "request" | "callback";
    reason: string;
    /** Decimal string — JSON has no bigint. */
    blockNumber: string;
    timestamp: number;
}

export interface SessionRecords {
    decrypted: Record<string, DecryptedMessage>;
    attempts: LocalAttempt[];
}

const MAX_ATTEMPTS = 50;
const EMPTY: SessionRecords = { decrypted: {}, attempts: [] };

const byReader = new Map<string, SessionRecords>();
const loaded = new Set<string>();
const listeners = new Set<() => void>();

const readerKey = (reader: Address) => reader.toLowerCase();
const vaultName = (reader: Address) => `records:${chain.id}:${readerKey(reader)}`;

export const decryptedKey = (channel: Address, offset: number) =>
    `${channel.toLowerCase()}:${offset}`;

function update(reader: Address, change: (current: SessionRecords) => SessionRecords) {
    const next = change(byReader.get(readerKey(reader)) ?? EMPTY);
    byReader.set(readerKey(reader), next);
    for (const listener of listeners) listener();
    void vaultWrite(vaultName(reader), next);
}

export const sessionRecords = {
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    get(reader: Address | undefined): SessionRecords {
        return (reader && byReader.get(readerKey(reader))) || EMPTY;
    },

    async load(reader: Address) {
        if (loaded.has(readerKey(reader))) return;
        loaded.add(readerKey(reader));
        const stored = await vaultRead<SessionRecords>(vaultName(reader));
        if (!stored) return;
        // Anything recorded while the vault was loading is newer than what it held.
        const current = byReader.get(readerKey(reader)) ?? EMPTY;
        byReader.set(readerKey(reader), {
            decrypted: { ...stored.decrypted, ...current.decrypted },
            attempts: [...current.attempts, ...stored.attempts].slice(0, MAX_ATTEMPTS),
        });
        for (const listener of listeners) listener();
    },

    addAttempt(attempt: LocalAttempt) {
        update(attempt.reader, (current) => ({
            ...current,
            attempts: [
                attempt,
                ...current.attempts.filter((entry) => entry.txHash !== attempt.txHash),
            ].slice(0, MAX_ATTEMPTS),
        }));
    },

    clear(reader: Address) {
        byReader.delete(readerKey(reader));
        loaded.delete(readerKey(reader));
        vaultRemove(vaultName(reader));
        for (const listener of listeners) listener();
    },
};

/**
 * Decrypts a disclosure addressed to `reader` and records it. Throws when this tab holds
 * no key for the reader, or when the plaintext is not text — the likely sign of a payload
 * sealed to a different key, since the ECIES here carries no MAC.
 */
export async function openDisclosure(params: {
    reader: Address;
    channel: Address;
    offset: number;
    payload: Hex;
    txHash: Hex;
}): Promise<DecryptedMessage> {
    const plaintext = await viewKey.decrypt(params.reader, params.payload);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    let envelope: Envelope | null = null;
    try {
        envelope = decode(plaintext);
    } catch {
        // Not every channel carries envelopes; the text is still worth showing.
    }

    const message: DecryptedMessage = {
        channel: params.channel,
        offset: params.offset,
        envelope,
        text,
        txHash: params.txHash,
        decryptedAt: Math.floor(Date.now() / 1000),
    };
    update(params.reader, (current) => ({
        ...current,
        decrypted: {
            ...current.decrypted,
            [decryptedKey(params.channel, params.offset)]: message,
        },
    }));
    return message;
}
