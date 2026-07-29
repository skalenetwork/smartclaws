import { describe, expect, test } from "bun:test";
import { RecordStore } from "../src/status.js";
import { createVerificationTools } from "../src/tools.js";
import type { VerificationRecord } from "../src/types.js";

function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
    return {
        startedAt: 0,
        endpoint: "https://n.completions.near.ai",
        model: "m",
        chatId: "chat-1",
        checks: [{ name: "message signature", result: "PASS", detail: "" }],
        status: "PASS",
        evidence: "PROVEN",
        ...overrides,
    };
}

async function execute(
    tool: ReturnType<typeof createVerificationTools>[number],
    params: { selector?: string } = {},
): Promise<string> {
    const result = await tool.execute("call-1", params);
    return result.content[0]?.text ?? "";
}

describe("verification agent tools", () => {
    test("list tool returns only current-session chat ids", async () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1", chatId: "mine" }));
        store.add(record({ sessionId: "s2", chatId: "secret" }));
        const [list] = createVerificationTools({ sessionId: "s1" }, store);

        const text = await execute(list);
        expect(text).toContain("mine");
        expect(text).not.toContain("secret");
    });

    test("verify tool accepts latest and an exact chat id", async () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s1", chatId: "old", evidence: "ATTESTED" }));
        store.add(record({ sessionId: "s1", chatId: "new", evidence: "PROVEN" }));
        const [, verify] = createVerificationTools({ sessionId: "s1" }, store);

        expect(await execute(verify, { selector: "latest" })).toContain("chat new");
        const old = await execute(verify, { selector: "old" });
        expect(old).toContain("chat old");
        expect(old).toContain("ATTESTED");
    });

    test("verify tool cannot read another session by chat id", async () => {
        const store = new RecordStore();
        store.add(record({ sessionId: "s2", chatId: "secret" }));
        const [, verify] = createVerificationTools({ sessionId: "s1" }, store);

        expect(await execute(verify, { selector: "secret" })).toContain("No matching");
    });

    test("tools fail closed without a trusted session id", async () => {
        const store = new RecordStore();
        store.add(record({ sessionId: undefined, chatId: "global" }));
        const [list, verify] = createVerificationTools({}, store);

        expect(await execute(list)).toContain("No trusted session context");
        expect(await execute(verify)).toContain("No trusted session context");
    });
});
