import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import {
    createDefaultConfig,
    homeFingerprint,
    saveConfig,
    setViewKey,
    SmartClawsError,
    updateHomeConfig,
} from "../../src/index.ts";
import { generateWallet } from "../../src/wallet.ts";

describe("home fingerprints and config updates", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("fingerprint is stable until public state changes", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-fp-"));
        generateWallet(tempDir);
        saveConfig(
            createDefaultConfig(
                "base-testnet",
                "https://rpc.example.com",
                42,
                "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
                "controller",
            ),
            tempDir,
        );
        const first = homeFingerprint(tempDir);
        const second = homeFingerprint(tempDir);
        expect(first).toBe(second);
        expect(first).toMatch(/^[a-f0-9]{64}$/);

        const loaded = createDefaultConfig(
            "base-testnet",
            "https://rpc.example.com",
            42,
            "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
            "bridge-agent",
        );
        saveConfig(loaded, tempDir);
        expect(homeFingerprint(tempDir)).not.toBe(first);
    });

    test("fingerprint changes when the active viewing key is replaced", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-fp-"));
        generateWallet(tempDir);
        setViewKey(generatePrivateKey(), tempDir);
        const first = homeFingerprint(tempDir);

        setViewKey(generatePrivateKey(), tempDir);
        expect(homeFingerprint(tempDir)).not.toBe(first);
    });

    test("fingerprint changes when only a redacted RPC credential changes", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-fp-"));
        const wallet = generateWallet(tempDir);
        const config = createDefaultConfig(
            "base-testnet",
            "https://rpc.example.com?apikey=first-secret",
            42,
            "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
            "controller",
            wallet.address,
        );
        saveConfig(config, tempDir);
        const first = homeFingerprint(tempDir);

        saveConfig(
            { ...config, rpcUrl: "https://rpc.example.com?apikey=other-secret" },
            tempDir,
        );
        expect(homeFingerprint(tempDir)).not.toBe(first);
    });

    test("refuses a stale fingerprint", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-fp-"));
        const wallet = generateWallet(tempDir);
        saveConfig(
            createDefaultConfig(
                "base-testnet",
                "https://rpc.example.com",
                42,
                "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
                "controller",
                wallet.address,
            ),
            tempDir,
        );
        expect(() =>
            updateHomeConfig({
                homeDir: tempDir,
                expectedFingerprint: "deadbeef",
                patch: { mode: "controller" },
            }),
        ).toThrow(SmartClawsError);
        try {
            updateHomeConfig({
                homeDir: tempDir,
                expectedFingerprint: "deadbeef",
                patch: { mode: "controller" },
            });
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("STATE_CHANGED");
        }
    });

    test("refuses deployment changes while attachments exist", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-fp-"));
        const wallet = generateWallet(tempDir);
        saveConfig(
            {
                ...createDefaultConfig(
                    "base-testnet",
                    "https://rpc.example.com",
                    42,
                    "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
                    "controller",
                    wallet.address,
                ),
                attachedGroupAddress: "0x0000000000000000000000000000000000000011",
            },
            tempDir,
        );
        const fingerprint = homeFingerprint(tempDir);
        expect(() =>
            updateHomeConfig({
                homeDir: tempDir,
                expectedFingerprint: fingerprint,
                patch: { registryAddress: "0x00000000000000000000000000000000000000aa" },
            }),
        ).toThrow(/home reset/i);
    });
});
