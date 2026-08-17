import { SmartClawsError } from "@smartclaws/sdk";

export function throwIfAborted(signal: AbortSignal | undefined): void {
    signal?.throwIfAborted();
}

export async function mapPool<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
    signal?: AbortSignal,
): Promise<R[]> {
    if (items.length === 0) return [];
    const results: R[] = new Array(items.length);
    let next = 0;
    async function worker(): Promise<void> {
        while (true) {
            throwIfAborted(signal);
            const index = next;
            next += 1;
            if (index >= items.length) return;
            results[index] = await mapper(items[index]);
        }
    }
    const workers = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results;
}

export function requireConfirmedReceipt(status: string, txHash: string, action: string): void {
    if (status === "success") return;
    throw new SmartClawsError("TRANSACTION_REVERTED", `${action} transaction reverted`, { txHash });
}

export function requireConfirm(confirm: boolean | undefined, action: string): void {
    if (confirm === true) return;
    throw new SmartClawsError("INVALID_TARGET", `${action} requires confirm: true.`, {
        confirm: confirm ?? false,
    });
}

export function requireExactlyOneTarget(present: Record<string, unknown>, labels: string[]): void {
    const set = labels.filter((label) => present[label] !== undefined && present[label] !== "");
    if (set.length !== 1) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            `Provide exactly one of ${labels.map((label) => `\`${label}\``).join(", ")}.`,
            { provided: set },
        );
    }
}
