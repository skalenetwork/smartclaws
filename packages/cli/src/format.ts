import type { PublishResult, PublishState, ReadMessage } from "@smartclaws/sdk";
import { formatEther } from "viem";

const FAILED_PUBLISH: ReadonlySet<PublishState> = new Set(["origin-reverted", "ctx-reverted"]);

/** JSON output must stringify bigint fee fields — `JSON.stringify` cannot. */
export function jsonStringify(value: unknown): string {
    return JSON.stringify(
        value,
        (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
        2,
    );
}

/**
 * Encrypted `--no-wait` must say Scheduled, never Published: origin success is not storage.
 * `body` is the rest of the line, e.g. `to sensor/topic`.
 */
export function publishHeadline(status: PublishState, body: string): string {
    if (status === "scheduled") return `Scheduled ${body}`;
    if (status === "published") return `Published ${body}`;
    return `Publish ${status}: ${body}`;
}

export function isFailedPublish(status: PublishState): boolean {
    return FAILED_PUBLISH.has(status);
}

export function printPublishDetails(
    result: PublishResult,
    extra: Array<[label: string, value: string]> = [],
    write: (line: string) => void = console.log,
): void {
    for (const [label, value] of extra) {
        write(`  ${label.padEnd(9)}${value}`);
    }
    write(`  Tx:      ${result.txHash}`);
    write(`  Status:  ${result.status}`);
    if (result.confirmedOffset !== undefined) {
        write(`  Offset:  ${result.confirmedOffset}`);
    }
    if (result.ctxHashes && result.ctxHashes.length > 0) {
        write(`  CTX:     ${result.ctxHashes.join(", ")}`);
    }
    if (result.callbackDeposit !== undefined) {
        write(`  Deposit: ${result.callbackDeposit.toString()} wei`);
    }
}

/** Returns false when the caller should exit(1). */
export function printPublishOutcome(
    result: PublishResult,
    headline: string,
    extra: Array<[label: string, value: string]> = [],
): boolean {
    if (isFailedPublish(result.status)) {
        console.error(headline);
        printPublishDetails(result, extra, console.error);
        return false;
    }
    console.log(headline);
    printPublishDetails(result, extra);
    return true;
}

export function formatReadMessageLine(message: ReadMessage, raw: boolean): string {
    if (raw) return `[${message.offset}] ${message.rawHex}`;
    if (message.encrypted) {
        const bytes = message.ciphertextBytes ?? 0;
        return `[${message.offset}] encrypted ciphertext, ${bytes} bytes`;
    }
    if (message.decodeError) {
        return `[${message.offset}] (decode error) ${message.rawHex.slice(0, 40)}...`;
    }
    const ts = new Date((message.ts ?? 0) * 1000).toISOString();
    return `[${message.offset}] ${ts} ${message.dev}/${message.topic} ${JSON.stringify(message.p)}`;
}

export function formatDisclosureCost(value: bigint, symbol = "sFUEL"): string {
    return (
        `This disclosure will send a callback deposit of ${value.toString()} wei` +
        ` (${formatEther(value)} ${symbol}).` +
        " Refunds are asynchronous; this is not the final cost."
    );
}

export function entityKindLabel(encrypted: boolean): string {
    return encrypted ? "encrypted" : "plain";
}

export function parseReaderChannelSide(value: string): "incoming" | "outgoing" {
    if (value === "incoming" || value === "outgoing") return value;
    console.error("--channel must be incoming or outgoing.");
    process.exit(1);
}
