import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertHomeWallet,
    createDefaultConfig,
    loadConfig,
    saveConfig,
    type WalletFile,
} from "../../src/index.ts";

describe("config", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true });
        }
    });

    test("createDefaultConfig sets v2 identity fields correctly", () => {
        const config = createDefaultConfig(
            "base-testnet",
            "https://rpc.example.com",
            1351057110,
            "0xABC",
            "bridge-agent",
            "0xwallet",
        );
        expect(config.version).toBe(2);
        expect(config.network).toBe("base-testnet");
        expect(config.rpcUrl).toBe("https://rpc.example.com");
        expect(config.chainId).toBe(1351057110);
        expect(config.contractAddress).toBe("0xABC");
        expect(config.walletAddress).toBe("0xwallet");
        expect(config.mode).toBe("bridge-agent");
        expect(config.attachedDeviceAddresses).toEqual([]);
    });

    test("config round-trips through JSON", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        const config = createDefaultConfig("base-testnet", "https://rpc.example.com", 42, "0x123");
        saveConfig(config, tempDir);

        const loaded = loadConfig(tempDir);
        expect(loaded).toEqual(config);
    });

    test("loads v1 config through backward-compatible migration", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 1,
                network: "local",
                rpcUrl: "http://127.0.0.1:8545",
                chainId: 31337,
                contractAddress: "0xregistry",
                deviceGroupAddress: "0xgroup",
            }),
        );

        const loaded = loadConfig(tempDir);
        expect(loaded?.version).toBe(2);
        expect(loaded?.deviceGroupAddress).toBe("0xgroup");
        expect(loaded?.attachedGroupAddress).toBe("0xgroup");
        expect(loaded?.mode).toBe("controller");
    });

    test("assertHomeWallet rejects a mismatched wallet", () => {
        const config = createDefaultConfig(
            "local",
            "http://127.0.0.1:8545",
            31337,
            "0xregistry",
            "controller",
            "0xabc",
        );
        const wallet: WalletFile = { address: "0xdef", privateKey: "0xkey" };
        expect(() => assertHomeWallet(config, wallet)).toThrow("HOME belongs to 0xabc");
    });

    test("missing config file is detectable", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        expect(loadConfig(tempDir)).toBeNull();
    });
});
