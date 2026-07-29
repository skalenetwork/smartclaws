/**
 * Typed error for SmartClaws service functions. Services never call `console`
 * or `process.exit`; they throw `SmartClawsError` so each consumer (CLI,
 * OpenClaw plugin, future provider plugins) can present failures its own way.
 */
export type SmartClawsErrorCode =
    | "NOT_INITIALIZED"
    | "NO_WALLET"
    | "INVALID_TARGET"
    | "DEVICE_NOT_FOUND"
    | "INVALID_RANGE"
    | "NO_RPC"
    | "BALANCE_FETCH_FAILED"
    | "HOME_WALLET_MISMATCH"
    | "ENTITY_NOT_FOUND"
    | "AMBIGUOUS_ENTITY"
    | "MODE_CONSTRAINT"
    | "MISSING_PERMISSION";

export class SmartClawsError extends Error {
    readonly code: SmartClawsErrorCode;
    readonly details?: Record<string, unknown>;

    constructor(code: SmartClawsErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "SmartClawsError";
        this.code = code;
        this.details = details;
    }
}
