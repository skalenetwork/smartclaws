import { describe, expect, test } from "bun:test";
import type { PublishResult, ReadMessage } from "@smartclaws/sdk";
import {
    formatDisclosureCost,
    formatReadMessageLine,
    jsonStringify,
    publishHeadline,
} from "../../src/format.ts";

const TX = `0x${"ab".repeat(32)}` as `0x${string}`;
const CHANNEL = "0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf" as `0x${string}`;

function scheduledResult(): PublishResult {
    return {
        channel: CHANNEL,
        topic: "telemetry.switch_status",
        dev: "sensor-1",
        txHash: TX,
        status: "scheduled",
        encrypted: true,
        callbackDeposit: 1066800n,
    };
}

function publishedResult(): PublishResult {
    return {
        ...scheduledResult(),
        status: "published",
        confirmedOffset: 3,
        ctxHashes: [`0x${"cd".repeat(32)}`],
    };
}

describe("encrypted publish output strings", () => {
    test("no-wait encrypted publish says Scheduled, never Published", () => {
        const result = scheduledResult();
        const line = publishHeadline(result.status, `to sensor-1/${result.topic}`);
        expect(line).toBe("Scheduled to sensor-1/telemetry.switch_status");
        expect(line).not.toContain("Published");

        const channelLine = publishHeadline(
            result.status,
            `${result.dev}/${result.topic} to channel ${result.channel}`,
        );
        expect(channelLine).toBe(
            "Scheduled sensor-1/telemetry.switch_status to channel 0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf",
        );
        expect(channelLine).not.toContain("Published");
    });

    test("wait encrypted publish says Published only after CTX confirmation", () => {
        const result = publishedResult();
        expect(publishHeadline(result.status, `to sensor-1/${result.topic}`)).toBe(
            "Published to sensor-1/telemetry.switch_status",
        );
        expect(
            publishHeadline(
                result.status,
                `${result.dev}/${result.topic} to channel ${result.channel}`,
            ),
        ).toBe(
            "Published sensor-1/telemetry.switch_status to channel 0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf",
        );
    });
});

describe("jsonStringify", () => {
    test("stringifies bigint fee fields", () => {
        const json = jsonStringify({ callbackDeposit: 1066800n, status: "scheduled" });
        expect(json).toContain('"callbackDeposit": "1066800"');
        expect(JSON.parse(json).callbackDeposit).toBe("1066800");
    });
});

describe("encrypted read labels", () => {
    test("ciphertext reads are labelled, not decode errors", () => {
        const message: ReadMessage = {
            offset: 3,
            rawHex: "0xabcd",
            encrypted: true,
            ciphertextHex: "0xabcd",
            ciphertextBytes: 323,
        };
        expect(formatReadMessageLine(message, false)).toBe("[3] encrypted ciphertext, 323 bytes");
        expect(formatReadMessageLine(message, false)).not.toContain("decode error");
    });

    test("disclosure cost is stated in wei and sFUEL before spending", () => {
        expect(formatDisclosureCost(1066800n)).toBe(
            "This disclosure will send a callback deposit of 1066800 wei (0.0000000000010668 sFUEL). Refunds are asynchronous; this is not the final cost.",
        );
    });
});
