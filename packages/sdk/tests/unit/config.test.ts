import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertHomeWallet,
    createDefaultConfig,
    loadConfig,
    resolveBiteRpcUrl,
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

    test("loads v1 config through backward-compatible migration", () => {
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
                walletAddress: "0xwallet",
                attachedGroupAddress: "0xattached-group",
                attachedAgentAddress: "0xattached-agent",
                attachedDeviceAddresses: ["0xdevice-1", "0xdevice-2"],
            }),
        );

        const loaded = loadConfig(tempDir);
        expect(loaded?.version).toBe(3);
        expect(loaded?.deviceGroupAddress).toBe("0xgroup");
        expect(loaded?.walletAddress).toBe("0xwallet");
        expect(loaded?.attachedGroupAddress).toBe("0xattached-group");
        expect(loaded?.attachedAgentAddress).toBe("0xattached-agent");
        expect(loaded?.attachedDeviceAddresses).toEqual(["0xdevice-1", "0xdevice-2"]);
        expect(loaded?.contractAddress).toBe("0xLegacyRegistryABC");
        expect(loaded?.mode).toBe("controller");
    });

    test("maps a legacy v1 device group to the attached group", () => {
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

        expect(loadConfig(tempDir)?.attachedGroupAddress).toBe("0xgroup");
    });

    test("loads v2 config through backward-compatible migration", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 2,
                network: "legacy",
                rpcUrl: "https://legacy-rpc.example.com",
                chainId: 42,
                contractAddress: "0xPreservedRegistryDEF",
                walletAddress: "0xwallet-v2",
                mode: "master-agent",
                deviceGroupAddress: "0xlegacy-group",
                attachedGroupAddress: "0xattached-group-v2",
                attachedAgentAddress: "0xattached-agent-v2",
                attachedDeviceAddresses: ["0xdevice-v2"],
            }),
        );

        const loaded = loadConfig(tempDir);
        expect(loaded?.version).toBe(3);
        expect(loaded?.walletAddress).toBe("0xwallet-v2");
        expect(loaded?.attachedGroupAddress).toBe("0xattached-group-v2");
        expect(loaded?.attachedAgentAddress).toBe("0xattached-agent-v2");
        expect(loaded?.attachedDeviceAddresses).toEqual(["0xdevice-v2"]);
        expect(loaded?.contractAddress).toBe("0xPreservedRegistryDEF");
    });

    test("loads a v3 config unchanged", () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        const config = {
            ...createDefaultConfig("current", "https://rpc.example.com", 42, "0xCurrentRegistry"),
            biteRpcUrl: "https://bite-rpc.example.com",
            attachedGroupAddress: "0xgroup",
            attachedAgentAddress: "0xagent",
            attachedDeviceAddresses: ["0xdevice"],
        };
        writeFileSync(join(tempDir, "config.json"), JSON.stringify(config));

        expect(loadConfig(tempDir)).toEqual(config);
    });

    test("BITE RPC falls back to the chain RPC when no override is configured", () => {
        expect(resolveBiteRpcUrl({ rpcUrl: "https://rpc.example.com" })).toBe(
            "https://rpc.example.com",
        );
    });

    test("BITE RPC uses its configured override", () => {
        expect(
            resolveBiteRpcUrl({
                rpcUrl: "https://rpc.example.com",
                biteRpcUrl: "https://bite-rpc.example.com",
            }),
        ).toBe("https://bite-rpc.example.com");
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
