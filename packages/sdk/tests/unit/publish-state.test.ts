import { describe, expect, test } from "bun:test";
import { SmartClawsError } from "../../src/errors.js";
import { type PublishState, publishStateFromError } from "../../src/services/channels.js";

/**
 * Pins the error → PublishState table. These codes imply opposite recovery:
 * ORIGIN_REVERTED is safe to resubmit; CTX_NOT_FOUND must never be retried as a
 * new publish; CTX_FAILED is terminal. CTX_MALFORMED_RESPONSE is not a publish
 * outcome at all.
 */
const ROWS: Array<{
    code: SmartClawsError["code"];
    state: PublishState | undefined;
    recovery: string;
}> = [
    {
        code: "ORIGIN_REVERTED",
        state: "origin-reverted",
        recovery: "Nothing scheduled, no callback funded → safe to resubmit",
    },
    {
        code: "CTX_NOT_FOUND",
        state: "scheduled",
        recovery: "Wait ended, CTX may still land → re-check, never resubmit",
    },
    {
        code: "CTX_FAILED",
        state: "ctx-reverted",
        recovery: "Terminal; message dropped, funding not recoverable",
    },
    {
        code: "CTX_MALFORMED_RESPONSE",
        state: undefined,
        recovery: "Node response unparseable; not a publish failure",
    },
];

describe("error → PublishState mapping", () => {
    for (const row of ROWS) {
        test(`${row.code} → ${row.state ?? "not a publish failure"} (${row.recovery})`, () => {
            const error = new SmartClawsError(row.code, row.recovery);
            expect(publishStateFromError(error)).toBe(row.state);
        });
    }

    test("CTX_NOT_FOUND is scheduled, never a failure state", () => {
        const state = publishStateFromError(
            new SmartClawsError("CTX_NOT_FOUND", "No CTX has been crafted yet"),
        );
        expect(state).toBe("scheduled");
        expect(state).not.toBe("origin-reverted");
        expect(state).not.toBe("ctx-reverted");
    });

    test("CTX_MALFORMED_RESPONSE is not mapped, so callers surface the parse error", () => {
        const error = new SmartClawsError(
            "CTX_MALFORMED_RESPONSE",
            "CTX hash must contain exactly 32 bytes",
        );
        expect(publishStateFromError(error)).toBeUndefined();
        expect(publishStateFromError(error)).not.toBe("scheduled");
        expect(publishStateFromError(error)).not.toBe("ctx-reverted");
        expect(publishStateFromError(error)).not.toBe("origin-reverted");
        expect(publishStateFromError(error)).not.toBe("published");
    });

    test("unrelated errors and non-SmartClaws errors are not publish states", () => {
        expect(
            publishStateFromError(new SmartClawsError("TRANSACTION_REVERTED", "no")),
        ).toBeUndefined();
        expect(publishStateFromError(new Error("network down"))).toBeUndefined();
        expect(publishStateFromError("CTX_NOT_FOUND")).toBeUndefined();
    });
});
