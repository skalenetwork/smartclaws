import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createDefaultConfig,
    homeFingerprint,
    initializeHome,
    saveConfig,
    SmartClawsError,
} from "../../src/index.ts";
import { getSetupStatus } from "../../src/services/setup.ts";
import { generateWallet } from "../../src/wallet.ts";

function tempHome(): string {
    return mkdtempSync(join(tmpdir(), "smartclaws-setup-"));
}

describe("getSetupStatus", () => {
    let tempDir: string;

    afterEach(() => {
        mock.restore();
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("reports uninitialized when no HOME exists", async () => {
        tempDir = tempHome();
        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("uninitialized");
        expect(status.ready).toBe(false);
        expect(status.home.exists).toBe(false);
        expect(status.wallet).toBeNull();
        expect(status.issues[0]?.code).toBe("HOME_NOT_INITIALIZED");
        expect(status.home.fingerprint).toBe(homeFingerprint(tempDir));
        expect(JSON.stringify(status)).not.toContain("privateKey");
        expect(JSON.stringify(status)).not.toContain(tempDir);
    });

    test("reports wallet-missing when config exists without a wallet", async () => {
        tempDir = tempHome();
        saveConfig(
            createDefaultConfig(
                "base-testnet",
                "https://rpc.example.com",
                324705682,
                "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
            ),
            tempDir,
        );
        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("wallet-missing");
        expect(status.configuration.persisted?.network).toBe("base-testnet");
    });

    test("reports stale-config without failing", async () => {
        tempDir = tempHome();
        const { writeFileSync, mkdirSync } = await import("node:fs");
        mkdirSync(join(tempDir, "wallets"), { recursive: true });
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({ version: 2, network: "base-testnet" }),
        );
        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("stale-config");
        expect(status.home.staleConfig).toBe(true);
        expect(status.issues[0]?.recommendedTool).toBe("smartclaws_home_reset");
    });

    test("reports configuration-incomplete when rpc/registry are missing", async () => {
        tempDir = tempHome();
        generateWallet(tempDir);
        saveConfig(createDefaultConfig("", "", 0, "", "controller"), tempDir);
        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("configuration-incomplete");
    });

    test("returns local state plus rpc diagnostic when RPC is offline", async () => {
        tempDir = tempHome();
        const initialized = initializeHome({
            homeDir: tempDir,
            mode: "controller",
            network: "base-testnet",
        });
        const walletService = await import("../../src/services/wallet.ts");
        spyOn(walletService, "getWalletInfo").mockRejectedValue(
            new Error("fetch failed https://user:secret@rpc.example.com"),
        );
        const status = await getSetupStatus({
            homeDir: tempDir,
            overrides: { rpcUrl: "https://rpc.example.com" },
        });
        expect(status.home.exists).toBe(true);
        expect(status.wallet?.address.toLowerCase()).toBe(initialized.walletAddress.toLowerCase());
        expect(status.state).toBe("degraded-rpc");
        expect(status.rpc.ok).toBe(false);
        expect(status.rpc.error).toBeTruthy();
        expect(status.rpc.error).not.toContain("secret");
        expect(status.configuration.shadowedFields).toContain("rpcUrl");
    });

    test("classifies an unfunded wallet when RPC reports a zero balance", async () => {
        tempDir = tempHome();
        const initialized = initializeHome({
            homeDir: tempDir,
            mode: "controller",
            network: "base-testnet",
        });
        const walletService = await import("../../src/services/wallet.ts");
        const keyTx = await import("../../src/services/key-transactions.ts");
        spyOn(walletService, "getWalletInfo").mockResolvedValue({
            address: initialized.walletAddress,
            balanceWei: "0",
            balance: "0",
            symbol: "CREDITS",
        });
        spyOn(keyTx, "getViewKeyStatus").mockResolvedValue({
            account: initialized.walletAddress as `0x${string}`,
            registry: "0x00000000000000000000000000000000000000e0",
            registered: false,
            matchesViewKey: false,
            usesSigningKey: true,
            localPublicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
            fingerprint: "abcdabcdabcdabcd",
        });

        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("wallet-unfunded");
        expect(status.wallet?.funded).toBe(false);
        expect(status.key?.registered).toBe(false);
    });

    test("classifies a ready HOME when funded and the registered key matches", async () => {
        tempDir = tempHome();
        const initialized = initializeHome({
            homeDir: tempDir,
            mode: "controller",
            network: "base-testnet",
        });
        const walletService = await import("../../src/services/wallet.ts");
        const keyTx = await import("../../src/services/key-transactions.ts");
        spyOn(walletService, "getWalletInfo").mockResolvedValue({
            address: initialized.walletAddress,
            balanceWei: "1000000000000000000",
            balance: "1",
            symbol: "CREDITS",
        });
        spyOn(keyTx, "getViewKeyStatus").mockResolvedValue({
            account: initialized.walletAddress as `0x${string}`,
            registry: "0x00000000000000000000000000000000000000e0",
            registered: true,
            matchesViewKey: true,
            usesSigningKey: true,
            localPublicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
            fingerprint: "abcdabcdabcdabcd",
        });

        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("ready");
        expect(status.ready).toBe(true);
        expect(status.key?.matchesViewKey).toBe(true);
    });

    test("classifies a public-key mismatch when the registry key is not the local view key", async () => {
        tempDir = tempHome();
        const initialized = initializeHome({
            homeDir: tempDir,
            mode: "controller",
            network: "base-testnet",
        });
        const walletService = await import("../../src/services/wallet.ts");
        const keyTx = await import("../../src/services/key-transactions.ts");
        spyOn(walletService, "getWalletInfo").mockResolvedValue({
            address: initialized.walletAddress,
            balanceWei: "1",
            balance: "0",
            symbol: "CREDITS",
        });
        spyOn(keyTx, "getViewKeyStatus").mockResolvedValue({
            account: initialized.walletAddress as `0x${string}`,
            registry: "0x00000000000000000000000000000000000000e0",
            registered: true,
            matchesViewKey: false,
            usesSigningKey: false,
            localPublicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
            fingerprint: "abcdabcdabcdabcd",
        });

        const status = await getSetupStatus({ homeDir: tempDir });
        expect(status.state).toBe("public-key-mismatch");
    });

    test("does not leak URL credentials in rpc diagnostics", async () => {
        tempDir = tempHome();
        initializeHome({ homeDir: tempDir, mode: "controller", network: "base-testnet" });
        const walletService = await import("../../src/services/wallet.ts");
        spyOn(walletService, "getWalletInfo").mockRejectedValue(
            new Error("connect https://user:secret@127.0.0.1:1/v1?apikey=abcd"),
        );
        const status = await getSetupStatus({
            homeDir: tempDir,
            overrides: { rpcUrl: "https://user:secret@rpc.example.com/v1?apikey=abcd" },
        });
        const serialized = JSON.stringify(status);
        expect(serialized).not.toContain("secret");
        expect(serialized).not.toContain("abcd");
        expect(serialized).toContain("REDACTED");
    });
});

describe("initializeHome", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("creates a named-network HOME and never returns a private key", () => {
        tempDir = tempHome();
        const result = initializeHome({
            homeDir: tempDir,
            mode: "controller",
            network: "base-testnet",
        });
        expect(result.generated).toBe(true);
        expect(result.network).toBe("base-testnet");
        expect(result.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(result).not.toHaveProperty("privateKey");
        expect(JSON.stringify(result)).not.toContain("privateKey");
        const leftover = readdirSync(tempDir).filter((name) => name.endsWith(".tmp"));
        expect(leftover).toEqual([]);
    });

    test("refuses when a wallet already exists", () => {
        tempDir = tempHome();
        generateWallet(tempDir);
        expect(() =>
            initializeHome({ homeDir: tempDir, mode: "controller", network: "base-testnet" }),
        ).toThrow(SmartClawsError);
    });

    test("refuses unknown networks", () => {
        tempDir = tempHome();
        expect(() =>
            initializeHome({ homeDir: tempDir, mode: "controller", network: "not-a-network" }),
        ).toThrow("Unknown network");
    });
});
