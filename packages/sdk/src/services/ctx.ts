import type { Hex } from "viem";
import { SmartClawsError } from "../errors.js";

const HASH_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/i;

export interface CtxClient<Receipt = unknown> {
    request(parameters: {
        method: "bite_getCraftedCtxs";
        params: readonly [Hex];
    }): Promise<unknown>;
    waitForTransactionReceipt(parameters: { hash: Hex }): Promise<Receipt>;
}

export interface CtxRetryOptions {
    attempts?: number;
    delayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    isNotFoundError?: (error: unknown) => boolean;
}

export function normalizeCtxHash(value: string): Hex {
    if (!HASH_PATTERN.test(value)) {
        throw new SmartClawsError(
            "CTX_MALFORMED_RESPONSE",
            "CTX hash must contain exactly 32 bytes",
            { hash: value },
        );
    }
    return `0x${value.replace(/^0x/i, "").toLowerCase()}`;
}

export function parseCtxHashes(result: unknown): Hex[] {
    const hashes: Hex[] = [];

    function visit(value: unknown): void {
        if (typeof value === "string") {
            // The live node currently returns bare hashes, while SDKs have observed nested
            // response shapes. Preserve that loose traversal, but never silently discard a
            // value that presents itself as hex: it is either a full hash or a malformed RPC
            // response. Ordinary non-hex metadata remains ignorable.
            if (/^0x/i.test(value) || /^[0-9a-fA-F]+$/.test(value)) {
                hashes.push(normalizeCtxHash(value));
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === "object") {
            for (const item of Object.values(value)) visit(item);
        }
    }

    visit(result);
    return [...new Set(hashes)];
}

function defaultIsNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /not found|not yet|unknown transaction/i.test(error.message);
}

const defaultSleep = (delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function getCtxHashes<Receipt>(
    client: CtxClient<Receipt>,
    originHash: Hex,
    options: CtxRetryOptions = {},
): Promise<Hex[]> {
    const normalizedOrigin = normalizeCtxHash(originHash);
    // Measured on base-testnet: the CTX landed in the very next block, 1s after the origin
    // (origin 2575264 -> CTX 2575265). Wall-clock cost is `attempts` round-trips plus
    // `attempts - 1` sleeps, so 5 gives roughly 9s — a wide margin over observed latency
    // without making a genuine failure take half a minute to surface.
    const attempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 1_000;
    const sleep = options.sleep ?? defaultSleep;
    const isNotFoundError = options.isNotFoundError ?? defaultIsNotFoundError;
    if (!Number.isInteger(attempts) || attempts < 1) {
        throw new RangeError("attempts must be a positive integer");
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const result = await client.request({
                method: "bite_getCraftedCtxs",
                params: [normalizedOrigin],
            });
            const hashes = parseCtxHashes(result);
            if (hashes.length > 0) return hashes;
        } catch (error) {
            // Malformed responses and transport/RPC failures are permanent for this operation.
            // Only the node's explicit "not found yet" state is safe to poll.
            if (!isNotFoundError(error)) throw error;
        }

        if (attempt < attempts) await sleep(delayMs);
    }

    // Not terminal: the caller stopped waiting. Re-querying later can still find the CTX,
    // so this must never be reported as a failed publish.
    throw new SmartClawsError(
        "CTX_NOT_FOUND",
        "No CTX has been crafted for the origin transaction yet",
        { originHash: normalizedOrigin, attempts },
    );
}

function receiptFailed(receipt: unknown): boolean {
    if (!receipt || typeof receipt !== "object" || !("status" in receipt)) return false;
    const status = (receipt as { status: unknown }).status;
    return status === "reverted" || status === "0x0" || status === 0;
}

export async function waitForCtxReceipts<Receipt>(
    client: CtxClient<Receipt>,
    originHash: Hex,
    options: CtxRetryOptions = {},
): Promise<{
    originHash: Hex;
    originReceipt: Receipt;
    ctxHashes: Hex[];
    ctxReceipts: Receipt[];
}> {
    const normalizedOrigin = normalizeCtxHash(originHash);
    const originReceipt = await client.waitForTransactionReceipt({ hash: normalizedOrigin });
    if (receiptFailed(originReceipt)) {
        // The submitting tx never made it, so the CTX stage was never entered. Reporting this
        // as a CTX failure would imply a dropped message and unrecoverable funding; neither
        // happened here.
        throw new SmartClawsError("ORIGIN_REVERTED", "Origin transaction reverted", {
            originHash: normalizedOrigin,
        });
    }

    const ctxHashes = await getCtxHashes(client, normalizedOrigin, options);
    const settled = await Promise.allSettled(
        ctxHashes.map((hash) => client.waitForTransactionReceipt({ hash })),
    );
    const rejected = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) {
        // A receipt wait can reject because the RPC timed out or became unavailable even
        // though the CTX is still pending (or has already succeeded). Only a mined receipt
        // with a reverted status below is terminal. Preserve the polling error so callers
        // keep the publish in its scheduled/unknown state instead of treating it as dropped.
        throw rejected.reason;
    }

    const ctxReceipts = settled.map((result) => (result as PromiseFulfilledResult<Receipt>).value);
    const failedIndex = ctxReceipts.findIndex(receiptFailed);
    if (failedIndex >= 0) {
        throw new SmartClawsError("CTX_FAILED", "CTX transaction reverted", {
            originHash: normalizedOrigin,
            ctxHash: ctxHashes[failedIndex],
        });
    }

    return { originHash: normalizedOrigin, originReceipt, ctxHashes, ctxReceipts };
}
