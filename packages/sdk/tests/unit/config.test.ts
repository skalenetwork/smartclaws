import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertHomeWallet,
    createDefaultConfig,
    loadConfig,
    readStaleConfigHints,
    SmartClawsError,
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

    test("createDefaultConfig sets v3 identity fields correctly", () => {
        const config = createDefaultConfig(
            "base-testnet",
            "https://rpc.example.com",
            1351057110,
            "0xABC",
            "bridge-agent",
            "0xwallet",
        );
        expect(config.version).toBe(3);
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

    test("refuses to load a pre-v3 config", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 1,
                network: "local",
                rpcUrl: "http://127.0.0.1:8545",
                chainId: 31337,
                contractAddress: "0xLegacyRegistryABC",
                deviceGroupAddress: "0xgroup",
            }),
        );

        try {
            loadConfig(tempDir);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            // Distinct from NOT_INITIALIZED: this HOME exists and holds a wallet, so the
            // CLI must route to init's reset path rather than "you have nothing here".
            expect((error as SmartClawsError).code).toBe("CONFIG_VERSION_UNSUPPORTED");
            expect((error as SmartClawsError).message).toContain("Re-run smartclaws init");
        }
    });

    test("refuses to load a v2 config", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 2,
                network: "legacy",
                rpcUrl: "https://legacy-rpc.example.com",
                chainId: 42,
                contractAddress: "0xPreservedRegistryDEF",
            }),
        );

        expect(() => loadConfig(tempDir)).toThrow("Re-run smartclaws init");
    });

    test("salvages only local preferences from a stale config", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 2,
                network: "base-testnet",
                rpcUrl: "https://custom-rpc.example.com",
                chainId: 42,
                mode: "master-agent",
                contractAddress: "0x2A49ADe245fE42E6C3eBC7972bB0Fe324fc923b5",
                attachedGroupAddress: "0xOldGroup",
                attachedAgentAddress: "0xOldAgent",
                attachedDeviceAddresses: ["0xOldDevice"],
            }),
        );

        const hints = readStaleConfigHints(tempDir);

        expect(hints).toEqual({
            version: 2,
            mode: "master-agent",
            network: "base-testnet",
            rpcUrl: "https://custom-rpc.example.com",
            chainId: 42,
        });
        // Every deployment-bound field must be dropped: carrying any of them forward would
        // leave a current config resolving to contracts in the superseded deployment.
        const carried = JSON.stringify(hints);
        expect(carried).not.toContain("0x2A49ADe245fE42E6C3eBC7972bB0Fe324fc923b5");
        expect(carried).not.toContain("0xOldGroup");
        expect(carried).not.toContain("0xOldAgent");
        expect(carried).not.toContain("0xOldDevice");
    });

    test("reports no stale hints for a current config or an absent one", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        expect(readStaleConfigHints(tempDir)).toBeNull();

        saveConfig(
            createDefaultConfig("current", "https://rpc.example.com", 42, "0xCurrentRegistry"),
            tempDir,
        );
        expect(readStaleConfigHints(tempDir)).toBeNull();
    });

    test("treats an unparseable config as stale with nothing to salvage", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(join(tempDir, "config.json"), "{ not json");

        expect(readStaleConfigHints(tempDir)).toEqual({ version: null });
    });

    test("loads a v3 config unchanged", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        const config = {
            ...createDefaultConfig("current", "https://rpc.example.com", 42, "0xCurrentRegistry"),
            attachedGroupAddress: "0xgroup",
            attachedAgentAddress: "0xagent",
            attachedDeviceAddresses: ["0xdevice"],
        };
        writeFileSync(join(tempDir, "config.json"), JSON.stringify(config));

        expect(loadConfig(tempDir)).toEqual(config);
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
