import { describe, expect, test } from "bun:test";
import {
    generateViewKeyIfAbsent,
    registerActiveViewKey,
    rotateViewKeyChecked,
    type ToolSpec,
    toolFactory,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";

describe("smartclaws_view_key_generate", () => {
    test("generates a local key fingerprint and never returns private material", async () => {
        const { viewKeyGenerateTool } = await import("../../src/tools/view-keys.ts");
        const spec = viewKeyGenerateTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_view_key_generate");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute({}, { smartclawsHome: HOME }, {})) as Record<
            string,
            unknown
        >;
        expect(generateViewKeyIfAbsent).toHaveBeenCalledWith(HOME);
        expect(result.status).toBe("generated");
        expect(result.registrationRequired).toBe(true);
        expect(JSON.stringify(result)).not.toContain("privateKey");
    });
});

describe("smartclaws_view_key_rotate", () => {
    test("passes the current fingerprint through to the SDK", async () => {
        const { viewKeyRotateTool } = await import("../../src/tools/view-keys.ts");
        const spec = viewKeyRotateTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            {
                expectedCurrentKeyFingerprint: "aa".repeat(8),
                confirmAbandonInflightDisclosures: true,
            },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(rotateViewKeyChecked).toHaveBeenCalledWith({
            homeDir: HOME,
            expectedCurrentKeyFingerprint: "aa".repeat(8),
            confirmAbandonInflightDisclosures: true,
        });
        expect(result.backupName).toMatch(/^backup-/);
        expect(result).not.toHaveProperty("path");
    });
});

describe("smartclaws_view_key_register", () => {
    test("registers the active viewing key and returns the tx hash", async () => {
        const { viewKeyRegisterTool } = await import("../../src/tools/view-keys.ts");
        const spec = viewKeyRegisterTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute({}, { smartclawsHome: HOME }, {})) as Record<
            string,
            unknown
        >;
        expect(registerActiveViewKey).toHaveBeenCalled();
        expect(result.status).toBe("confirmed");
        expect(result.matchesViewKey).toBe(true);
    });
});
