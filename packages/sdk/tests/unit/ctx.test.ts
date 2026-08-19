import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
    type CtxClient,
    getCtxHashes,
    normalizeCtxHash,
    parseCtxHashes,
    waitForCtxReceipts,
} from "../../src/services/ctx.js";

const origin = `0x${"01".repeat(32)}` as Hex;
const first = `0x${"AB".repeat(32)}` as Hex;
const second = `0x${"cd".repeat(32)}` as Hex;
const normalizedFirst = first.toLowerCase() as Hex;

// Captured verbatim from SKALE base-testnet via bite_getCraftedCtxs on origin tx
// 0x25d923aadf5fba6cca9fd8d62f29b080871e3cdc40da5eb2efe38f44dac7c698. The CTX it names
// succeeded and emitted MessagePublished(address,uint256).
//
// This shape cannot be reproduced locally — BITE has no local simulation, so the only
// evidence of the real wire format is a recorded live response. Treat it as the
// authoritative contract for this parser: the node returns a flat array of BARE 64-char
// hex strings with no 0x prefix. A parser that requires the prefix silently matches
// nothing and reports "no CTX was crafted" for every successful publish.
const LIVE_GET_CRAFTED_CTXS_RESULT = [
    "13fbace38a36acd6b61cd5fc974a569e217fed4e8fdf4378687ce8809808d92b",
];
const LIVE_CTX_HASH = `0x${LIVE_GET_CRAFTED_CTXS_RESULT[0]}` as Hex;

describe("CTX hash parsing", () => {
    test("parses the recorded live bite_getCraftedCtxs response", () => {
        expect(parseCtxHashes(LIVE_GET_CRAFTED_CTXS_RESULT)).toEqual([LIVE_CTX_HASH]);
    });

    test("rejects anything other than a 32-byte hash", () => {
        for (const malformed of ["0x", `0x${"11".repeat(31)}`, `0x${"11".repeat(33)}`, "11"]) {
            expect(() => normalizeCtxHash(malformed)).toThrow(
                expect.objectContaining({ code: "CTX_MALFORMED_RESPONSE" }),
            );
        }
        for (const response of [{ ctxs: [first, "0x1234"] }, ["1234"]]) {
            expect(() => parseCtxHashes(response)).toThrow(
                expect.objectContaining({ code: "CTX_MALFORMED_RESPONSE" }),
            );
        }
    });

    test("continues to tolerate non-hash metadata in loose RPC response shapes", () => {
        expect(parseCtxHashes({ status: "pending", ctxs: [] })).toEqual([]);
        expect(parseCtxHashes({ status: "ready", ctxs: [first] })).toEqual([normalizedFirst]);
    });

    test("normalizes case and collapses duplicates from loose RPC shapes", () => {
        expect(
            parseCtxHashes({ result: [first, { hash: normalizedFirst.slice(2) }, second] }),
        ).toEqual([normalizedFirst, second]);
        expect(normalizeCtxHash(`0X${"EF".repeat(32)}`)).toBe(`0x${"ef".repeat(32)}`);
    });
});

describe("CTX correlation", () => {
    test("waits for the origin and every deduplicated CTX receipt", async () => {
        const waited: Hex[] = [];
        const client: CtxClient<{ status: "success"; hash: Hex }> = {
            async request() {
                return [first, first.toLowerCase(), second];
            },
            async waitForTransactionReceipt({ hash }) {
                waited.push(hash);
                return { status: "success", hash };
            },
        };

        const result = await waitForCtxReceipts(client, origin, {
            attempts: 1,
            sleep: async () => undefined,
        });

        expect(result.ctxHashes).toEqual([normalizedFirst, second]);
        expect(result.ctxReceipts).toHaveLength(2);
        expect(waited).toEqual([origin, normalizedFirst, second]);
    });

    test("retries not-found results but immediately surfaces other failures", async () => {
        let requests = 0;
        const eventuallyFound: CtxClient = {
            async request() {
                requests += 1;
                if (requests === 1) throw new Error("transaction not found yet");
                return [first];
            },
            async waitForTransactionReceipt() {
                return {};
            },
        };
        expect(
            await getCtxHashes(eventuallyFound, origin, {
                attempts: 2,
                sleep: async () => undefined,
            }),
        ).toEqual([normalizedFirst]);
        expect(requests).toBe(2);

        requests = 0;
        const failed: CtxClient = {
            async request() {
                requests += 1;
                throw new Error("permission denied");
            },
            async waitForTransactionReceipt() {
                return {};
            },
        };
        await expect(
            getCtxHashes(failed, origin, { attempts: 3, sleep: async () => undefined }),
        ).rejects.toThrow("permission denied");
        expect(requests).toBe(1);
    });

    test("immediately surfaces a malformed RPC response without retrying it as not-found", async () => {
        let requests = 0;
        const malformed: CtxClient = {
            async request() {
                requests += 1;
                return ["1234"];
            },
            async waitForTransactionReceipt() {
                return {};
            },
        };

        await expect(
            getCtxHashes(malformed, origin, {
                attempts: 3,
                sleep: async () => undefined,
            }),
        ).rejects.toMatchObject({ code: "CTX_MALFORMED_RESPONSE" });
        expect(requests).toBe(1);
    });

    test("separates 'no CTX yet' from a terminal CTX failure", async () => {
        // A CTX must land eventually, so giving up waiting is not the same as failing.
        // Callers key retry/refund decisions off this distinction.
        const neverCrafted: CtxClient = {
            async request() {
                return [];
            },
            async waitForTransactionReceipt() {
                return { status: "success" };
            },
        };
        await expect(
            getCtxHashes(neverCrafted, origin, { attempts: 2, sleep: async () => undefined }),
        ).rejects.toMatchObject({ code: "CTX_NOT_FOUND" });

        const reverted: CtxClient = {
            async request() {
                return [first];
            },
            async waitForTransactionReceipt({ hash }) {
                return hash === origin ? { status: "success" } : { status: "reverted" };
            },
        };
        await expect(
            waitForCtxReceipts(reverted, origin, { attempts: 1, sleep: async () => undefined }),
        ).rejects.toMatchObject({ code: "CTX_FAILED" });
    });

    test("reports an origin revert as its own state, not a CTX failure", async () => {
        // No CTX is crafted for a reverted origin, so the CTX stage never runs. Conflating the
        // two would tell a caller its message was dropped and its funding lost.
        const originReverted: CtxClient = {
            async request() {
                throw new Error("should not be reached");
            },
            async waitForTransactionReceipt() {
                return { status: "reverted" };
            },
        };
        await expect(
            waitForCtxReceipts(originReverted, origin, {
                attempts: 1,
                sleep: async () => undefined,
            }),
        ).rejects.toMatchObject({ code: "ORIGIN_REVERTED" });
    });

    test("does not turn a receipt polling failure into a terminal CTX failure", async () => {
        const pollingError = new Error("HTTP 503 while polling for receipt");
        const temporarilyUnavailable: CtxClient = {
            async request() {
                return [first];
            },
            async waitForTransactionReceipt({ hash }) {
                if (hash === origin) return { status: "success" };
                throw pollingError;
            },
        };

        await expect(
            waitForCtxReceipts(temporarilyUnavailable, origin, {
                attempts: 1,
                sleep: async () => undefined,
            }),
        ).rejects.toBe(pollingError);
    });
});
