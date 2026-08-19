import { describe, expect, test } from "bun:test";
import { assertNotSelfLockout, assertNotSelfReaderRevocation, SmartClawsError } from "../../src/index.ts";

const WALLET = "0x0000000000000000000000000000000000000002";
const OTHER = "0x0000000000000000000000000000000000000003";

describe("self-lockout guards", () => {
    test("refuses administrative self-revocation without an explicit flag", () => {
        expect(() =>
            assertNotSelfLockout({
                walletAddress: WALLET,
                account: WALLET,
                role: "agent-admin",
            }),
        ).toThrow(SmartClawsError);
        try {
            assertNotSelfLockout({
                walletAddress: WALLET,
                account: WALLET,
                role: "master",
            });
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("SELF_LOCKOUT_RISK");
        }
    });

    test("allows publisher revocation and flagged self-revocation", () => {
        expect(() =>
            assertNotSelfLockout({
                walletAddress: WALLET,
                account: WALLET,
                role: "publisher",
            }),
        ).not.toThrow();
        expect(() =>
            assertNotSelfLockout({
                walletAddress: WALLET,
                account: WALLET,
                role: "agent-admin",
                allowSelfRevocation: true,
            }),
        ).not.toThrow();
        expect(() =>
            assertNotSelfLockout({
                walletAddress: WALLET,
                account: OTHER,
                role: "agent-admin",
            }),
        ).not.toThrow();
    });

    test("refuses removing the active wallet from a reader list", () => {
        expect(() =>
            assertNotSelfReaderRevocation({ walletAddress: WALLET, account: WALLET }),
        ).toThrow(SmartClawsError);
    });
});
