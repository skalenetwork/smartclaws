import type { Hex } from "viem";
import { SmartClawsError } from "./errors.js";

export function requireSuccessfulReceipt(
    receipt: { status: "success" | "reverted" },
    txHash: Hex,
    action: string,
): void {
    if (receipt.status === "success") return;
    throw new SmartClawsError("TRANSACTION_REVERTED", `${action} transaction reverted`, { txHash });
}

export function localSaveFailed(
    txHash: Hex,
    publicData: Record<string, unknown>,
    cause: unknown,
): SmartClawsError {
    return new SmartClawsError(
        "LOCAL_STATE_SAVE_FAILED",
        "On-chain registration confirmed, but local state could not be saved. Do not retry registration; attach the confirmed entity instead.",
        {
            txHash,
            ...publicData,
            cause: cause instanceof Error ? cause.message : String(cause),
        },
    );
}
