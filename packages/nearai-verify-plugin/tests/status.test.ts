import { describe, expect, test } from "bun:test";
import { formatRecords, parseCommandSelector, RecordStore } from "../src/status.js";
import type { VerificationRecord } from "../src/types.js";

function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
    return {
        startedAt: 0,
        endpoint: "https://n.completions.near.ai",
        model: "m",
        chatId: "c1",
        checks: [{ name: "message signature", result: "PASS", detail: "" }],
        status: "PASS",
        evidence: "PROVEN",
        ...overrides,
    };
}

describe("parseCommandSelector", () => {
    test("empty or 'latest' selects latest", () => {
        expect(parseCommandSelector(undefined)).toBe("latest");
        expect(parseCommandSelector("  ")).toBe("latest");
        expect(parseCommandSelector("LATEST")).toBe("latest");
    });
    test("anything else is a chat id", () => {
        expect(parseCommandSelector(" chat-9 ")).toEqual({ chatId: "chat-9" });
    });
});

describe("RecordStore session scoping", () => {
    test("returns records only for the caller's session", () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1", chatId: "a" }));
        expect(store.query({ sessionId: "s1", isOwner: false, selector: "latest" })).toHaveLength(
            1,
        );
        expect(store.query({ sessionId: "s2", isOwner: false, selector: "latest" })).toHaveLength(
            0,
        );
    });

    test("a chat id is not a cross-session lookup oracle", () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1", chatId: "secret" }));
        expect(
            store.query({ sessionId: "s2", isOwner: true, selector: { chatId: "secret" } }),
        ).toHaveLength(0);
    });

    test("global fallback is owner-only when there is no session", () => {
        const store = new RecordStore();
        store.add(record({ sessionId: undefined, chatId: "g" }));
        expect(
            store.query({ sessionId: undefined, isOwner: true, selector: "latest" }),
        ).toHaveLength(1);
        expect(
            store.query({ sessionId: undefined, isOwner: false, selector: "latest" }),
        ).toHaveLength(0);
    });

    test("latest returns the most recent record in scope", () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1", chatId: "old" }));
        store.add(record({ sessionId: "s1", chatId: "new" }));
        const [latest] = store.query({ sessionId: "s1", isOwner: false, selector: "latest" });
        expect(latest?.chatId).toBe("new");
    });

    test("clear drops all records", () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1" }));
        store.clear();
        expect(store.query({ sessionId: "s1", isOwner: false, selector: "latest" })).toHaveLength(
            0,
        );
    });

    test("evicts the least recently written session when the session cap is reached", () => {
        const store = new RecordStore({ maxSessions: 2 });
        store.add(record({ sessionId: "s1", chatId: "old" }));
        store.add(record({ sessionId: "s2", chatId: "middle" }));
        store.add(record({ sessionId: "s1", chatId: "recent" }));
        store.add(record({ sessionId: "s3", chatId: "new" }));

        expect(
            store.query({ sessionId: "s1", isOwner: false, selector: "latest" })[0]?.chatId,
        ).toBe("recent");
        expect(store.query({ sessionId: "s2", isOwner: false, selector: "latest" })).toHaveLength(
            0,
        );
        expect(
            store.query({ sessionId: "s3", isOwner: false, selector: "latest" })[0]?.chatId,
        ).toBe("new");
    });
});

describe("formatRecords", () => {
    test("summarizes without leaking bodies or keys", () => {
        const text = formatRecords([record({ signingAddress: "0xabc" })]);
        expect(text).toContain("c1");
        expect(text).toContain("PROVEN");
        expect(text).toContain("signer: 0xabc");
        expect(text).not.toContain("apiKey");
    });
    test("reports an empty result", () => {
        expect(formatRecords([])).toContain("No matching");
    });
});
