import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateWallet, loadWallet } from "../../src/wallet.ts";

describe("wallet", () => {
    let tempDir: string;

    afterEach(() => {
        delete process.env.SMARTCLAWS_HOME;
        if (tempDir && existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true });
        }
    });

    test("generateWallet creates wallet file with valid address and key", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        process.env.SMARTCLAWS_HOME = tempDir;

        const wallet = generateWallet();
        expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(wallet.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
        expect(existsSync(join(tempDir, "wallets", "default.json"))).toBe(true);
    });

    test("loadWallet returns null when no wallet exists", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        process.env.SMARTCLAWS_HOME = tempDir;

        expect(loadWallet()).toBeNull();
    });

    test("loadWallet returns previously generated wallet", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        process.env.SMARTCLAWS_HOME = tempDir;

        const generated = generateWallet();
        const loaded = loadWallet();
        expect(loaded).not.toBeNull();
        expect(loaded!.address).toBe(generated.address);
        expect(loaded!.privateKey).toBe(generated.privateKey);
    });
});
