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
    | "CONFIG_VERSION_UNSUPPORTED"
    | "MODE_CONSTRAINT"
    | "MISSING_PERMISSION"
    | "ENCRYPTION_UNSUPPORTED"
    | "REGISTRATION_KIND_MISMATCH"
    // An entity whose two channels are not the same kind, or whose kind disagrees with the
    // registry set it was discovered in. Not reachable today — both channels are deployed
    // together — but every consumer stores one `encrypted` flag per entity, so picking a
    // side would silently attach the wrong publish value on one of the two channels.
    | "CHANNEL_KIND_MISMATCH"
    | "TRANSACTION_REVERTED"
    | "NOT_A_READER"
    | "NO_PUBLIC_KEY"
    | "INSUFFICIENT_FEE"
    | "READ_BATCH_LIMIT"
    // The three encrypted-publish outcomes are kept distinct because they map onto separate
    // PublishStates and imply different recovery:
    //   ORIGIN_REVERTED  the submitting tx reverted, so no CTX was ever crafted. Nothing was
    //                    scheduled and nothing was spent on a callback -> safe to resubmit.
    //   CTX_NOT_FOUND    the wait ended before a CTX appeared. A CTX must land eventually,
    //                    so this is "not yet", not a failure -> re-check, never resubmit.
    //   CTX_FAILED       terminal. The CTX itself reverted; the message is dropped with no
    //                    retry path and the callback funding is not recoverable.
    | "ORIGIN_REVERTED"
    | "CTX_NOT_FOUND"
    | "CTX_MALFORMED_RESPONSE"
    | "CTX_FAILED"
    | "DISCLOSURE_TIMEOUT";

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
