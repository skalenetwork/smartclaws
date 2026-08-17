import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config, WalletFile } from "@smartclaws/core/types";
import * as viem from "viem";
import * as contracts from "../../src/contracts.js";
import { SmartClawsError } from "../../src/errors.js";
import { registerGroupWithResult } from "../../src/services/discovery.js";

const CONFIG: Config = {
    version: 3,
    network: "base-testnet",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:0",
    contractAddress: "0x0000000000000000000000000000000000000001",
    walletAddress: "0x0000000000000000000000000000000000000002",
    mode: "controller",
    deviceGroupAddress: "",
    attachedGroupAddress: "",
    attachedAgentAddress: "",
    attachedDeviceAddresses: [],
};

const WALLET: WalletFile = {
    address: "0x0000000000000000000000000000000000000002",
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
};

const TX = `0x${"ab".repeat(32)}` as const;
const GROUP = "0x00000000000000000000000000000000000000aa" as const;

describe("structured registration", () => {
    let tempDir: string;

    afterEach(() => {
        mock.restore();
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("returns the transaction hash after a successful receipt", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-reg-"));
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({
                    status: "success",
                    logs: [{ address: CONFIG.contractAddress, data: "0x", topics: ["0x01"] }],
                }),
            },
        } as never);
        spyOn(contracts, "getRegistryContract").mockReturnValue({
            abi: [],
            write: { registerDeviceGroup: async () => TX },
        } as never);
        spyOn(viem, "decodeEventLog").mockReturnValue({
            eventName: "DeviceGroupRegistered",
            args: { deviceGroup: GROUP },
        } as never);
        spyOn(contracts, "getDeviceGroupReadContract").mockReturnValue({
            read: {
                groupName: async () => "home",
                skills: async () => "",
                createdAt: async () => 1n,
                owner: async () => WALLET.address,
                getDeviceCount: async () => 0n,
                getDevices: async () => [],
                getEncryptedDeviceCount: async () => 0n,
                getEncryptedDevices: async () => [],
            },
        } as never);

        const result = await registerGroupWithResult(CONFIG, WALLET, "home", "", tempDir);
        expect(result.txHash).toBe(TX);
        expect(result.receiptStatus).toBe("success");
        expect(result.entity.groupAddress).toBe("0x00000000000000000000000000000000000000AA");
        expect(result.entity.name).toBe("home");
    });

    test("reverted receipts never become confirmed results", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-reg-"));
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "reverted", logs: [] }),
            },
        } as never);
        spyOn(contracts, "getRegistryContract").mockReturnValue({
            abi: [],
            write: { registerDeviceGroup: async () => TX },
        } as never);

        try {
            await registerGroupWithResult(CONFIG, WALLET, "home", "", tempDir);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("TRANSACTION_REVERTED");
            expect((error as SmartClawsError).details?.txHash).toBe(TX);
        }
    });

    test("on-chain success followed by local-save failure keeps the tx hash", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-reg-"));
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({
                    status: "success",
                    logs: [{ address: CONFIG.contractAddress, data: "0x", topics: ["0x01"] }],
                }),
            },
        } as never);
        spyOn(contracts, "getRegistryContract").mockReturnValue({
            abi: [],
            write: { registerDeviceGroup: async () => TX },
        } as never);
        spyOn(viem, "decodeEventLog").mockReturnValue({
            eventName: "DeviceGroupRegistered",
            args: { deviceGroup: GROUP },
        } as never);
        spyOn(contracts, "getDeviceGroupReadContract").mockImplementation(() => {
            throw new Error("disk full");
        });

        try {
            await registerGroupWithResult(CONFIG, WALLET, "home", "", tempDir);
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("LOCAL_STATE_SAVE_FAILED");
            expect((error as SmartClawsError).details?.txHash).toBe(TX);
            expect((error as SmartClawsError).details?.address).toBe(GROUP);
        }
    });
});
