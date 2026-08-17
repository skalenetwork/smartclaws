import { describe, expect, test } from "bun:test";
import type { PublishResult } from "@smartclaws/sdk";
import { presentPublishResult } from "../../src/tools/result.ts";
import { CALLBACK_DEPOSIT, CHANNEL, CTX_HASH, encryptedPublished, ORIGIN } from "./sdk-mock.ts";

/**
 * Pins the JSON object an agent sees for each PublishState. Shapes come from
 * the SDK's FakeEncryptionProvider path (Track 3A/3C). BITEMockup is not used
 * and is not a confidentiality oracle.
 *
 * A returned object must never be readable as "published" when it was only
 * scheduled: no `success` field, and `status` is passed through unchanged.
 */
const BASE = {
    channel: CHANNEL,
    topic: "telemetry.pm",
    dev: "sensor-1",
    txHash: ORIGIN,
    encrypted: true,
};

describe("presentPublishResult", () => {
    test("published includes confirmedOffset, ctxHashes, and stringified fee", () => {
        const result = presentPublishResult(encryptedPublished());
        expect(result).toEqual({
            ...BASE,
            status: "published",
            ctxHashes: [CTX_HASH],
            confirmedOffset: 9,
            callbackDeposit: CALLBACK_DEPOSIT.toString(),
        });
        expect(result).not.toHaveProperty("success");
        expect(typeof result.callbackDeposit).toBe("string");
    });

    test("scheduled (no-wait or CTX timeout) has no confirmedOffset and is not published", () => {
        const scheduled: PublishResult = {
            channel: CHANNEL as PublishResult["channel"],
            topic: "telemetry.pm",
            dev: "sensor-1",
            txHash: ORIGIN as PublishResult["txHash"],
            status: "scheduled",
            encrypted: true,
            callbackDeposit: CALLBACK_DEPOSIT,
        };
        const result = presentPublishResult(scheduled);
        expect(result).toEqual({
            ...BASE,
            status: "scheduled",
            callbackDeposit: CALLBACK_DEPOSIT.toString(),
        });
        expect(result.status).not.toBe("published");
        expect(result).not.toHaveProperty("confirmedOffset");
        expect(result).not.toHaveProperty("success");
        expect(result).not.toHaveProperty("ctxHashes");
    });

    test("origin-reverted omits the callback deposit (nothing was funded)", () => {
        const result = presentPublishResult({
            channel: CHANNEL as PublishResult["channel"],
            topic: "telemetry.pm",
            dev: "sensor-1",
            txHash: ORIGIN as PublishResult["txHash"],
            status: "origin-reverted",
            encrypted: true,
        });
        expect(result).toEqual({
            ...BASE,
            status: "origin-reverted",
        });
        expect(result.status).not.toBe("published");
        expect(result).not.toHaveProperty("callbackDeposit");
        expect(result).not.toHaveProperty("success");
    });

    test("ctx-reverted keeps the deposit and is not rewritten as published", () => {
        const result = presentPublishResult({
            channel: CHANNEL as PublishResult["channel"],
            topic: "telemetry.pm",
            dev: "sensor-1",
            txHash: ORIGIN as PublishResult["txHash"],
            status: "ctx-reverted",
            encrypted: true,
            callbackDeposit: CALLBACK_DEPOSIT,
            ctxHashes: [CTX_HASH as PublishResult["txHash"]],
        });
        expect(result).toEqual({
            ...BASE,
            status: "ctx-reverted",
            callbackDeposit: CALLBACK_DEPOSIT.toString(),
            ctxHashes: [CTX_HASH],
        });
        expect(result.status).not.toBe("published");
        expect(result).not.toHaveProperty("confirmedOffset");
        expect(result).not.toHaveProperty("success");
    });
});
