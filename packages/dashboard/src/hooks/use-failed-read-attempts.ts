import { useQuery } from "@tanstack/react-query";
import { type Address, decodeErrorResult, type Hex } from "viem";
import { chain, explorerUrl } from "@/config/wagmi";
import { describeRevert, revertAbi } from "@/lib/viewer/disclose";

/**
 * A disclosure attempt that failed on-chain. Failed transactions emit no events, so the RPC
 * log scan can never see these; the block explorer indexes them, so they come from there.
 */
export interface FailedReadAttempt {
    txHash: Hex;
    blockNumber: bigint;
    timestamp?: number;
    /** `request`: `requestMessages` reverted. `callback`: the CTX callback reverted. */
    stage: "request" | "callback";
    /** Unknown for a failed callback whose origin could not be looked up. */
    reader?: Address;
    offset?: number;
    reason: string;
}

interface ExplorerTx {
    hash: Hex;
    block_number: number;
    timestamp: string;
    status: "ok" | "error" | null;
    method: string | null;
    from: { hash: Address };
    revert_reason: { raw?: Hex; method_call?: string } | string | null;
    decoded_input: { parameters: { name: string; value: string }[] } | null;
    ctx_origin_transaction_hash?: Hex | null;
}

// One page is the 50 newest transactions to the channel. On a busy channel that covers the
// last hour or two, which is the window a demo cares about.
const POLL_INTERVAL_MS = 90_000;
const MAX_ORIGIN_LOOKUPS = 5;

function reasonOf(tx: ExplorerTx): string {
    const revert = tx.revert_reason;
    if (revert && typeof revert === "object") {
        if (revert.method_call) return describeRevert(revert.method_call.split("(")[0]);
        if (revert.raw) {
            try {
                return describeRevert(
                    decodeErrorResult({ abi: revertAbi, data: revert.raw }).errorName,
                );
            } catch {
                // Not one of ours; fall through to the generic reason.
            }
        }
    }
    return typeof revert === "string" && revert ? revert : describeRevert(undefined);
}

function fromOffsetOf(tx: ExplorerTx | undefined): number | undefined {
    const value = tx?.decoded_input?.parameters.find((param) => param.name === "fromOffset")?.value;
    return value === undefined ? undefined : Number(value);
}

async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${explorerUrl}/api/v2${path}`);
    if (!response.ok) throw new Error(`Explorer responded ${response.status}`);
    return (await response.json()) as T;
}

export function useFailedReadAttempts(channel: Address | undefined, enabled = true) {
    return useQuery<FailedReadAttempt[], Error>({
        queryKey: ["failed-read-attempts", chain.id, channel?.toLowerCase()],
        queryFn: async () => {
            const { items } = await fetchJson<{ items: ExplorerTx[] }>(
                `/addresses/${channel}/transactions?filter=to`,
            );
            const failed = items.filter(
                (tx) =>
                    tx.status === "error" &&
                    (tx.method === "requestMessages" || tx.method === "onDecrypt"),
            );

            // A failed callback does not say who asked; its origin transaction does.
            const origins = new Map<string, ExplorerTx>();
            const originHashes = failed
                .filter((tx) => tx.method === "onDecrypt" && tx.ctx_origin_transaction_hash)
                .map((tx) => tx.ctx_origin_transaction_hash as Hex)
                .slice(0, MAX_ORIGIN_LOOKUPS);
            await Promise.all(
                originHashes.map(async (hash) => {
                    try {
                        origins.set(hash, await fetchJson<ExplorerTx>(`/transactions/${hash}`));
                    } catch {
                        // The row still shows, just without a reader.
                    }
                }),
            );

            return failed.map((tx) => {
                const origin =
                    tx.method === "onDecrypt" && tx.ctx_origin_transaction_hash
                        ? origins.get(tx.ctx_origin_transaction_hash)
                        : tx;
                return {
                    txHash: tx.hash,
                    blockNumber: BigInt(tx.block_number),
                    timestamp: Math.floor(Date.parse(tx.timestamp) / 1000) || undefined,
                    stage: tx.method === "onDecrypt" ? "callback" : "request",
                    reader: origin?.from.hash,
                    offset: fromOffsetOf(origin),
                    reason: reasonOf(tx),
                } satisfies FailedReadAttempt;
            });
        },
        enabled: enabled && !!channel && !!explorerUrl,
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        placeholderData: (previous) => previous,
        retry: 1,
    });
}
