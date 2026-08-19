import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Config, WalletFile } from "@smartclaws/core/types";
import * as contracts from "../../src/contracts.js";
import { SmartClawsError } from "../../src/errors.js";
import {
    registerActiveViewKey,
    removeRegisteredPublicKey,
} from "../../src/services/key-transactions.js";
import * as keys from "../../src/services/keys.js";

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
    viewPrivateKey: "0x0000000000000000000000000000000000000000000000000000000000000002",
};

const TX = `0x${"cd".repeat(32)}` as const;
const REGISTRY = "0x00000000000000000000000000000000000000e0" as const;

describe("viewing-key transactions", () => {
    afterEach(() => {
        mock.restore();
        contracts.clearContractCaches();
    });

    test("registerActiveViewKey waits for a successful receipt and verifies the postcondition", async () => {
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(REGISTRY);
        spyOn(contracts, "getClients").mockReturnValue({
            walletClient: {},
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "success" }),
            },
        } as never);
        spyOn(contracts, "getPublicClient").mockReturnValue({} as never);
        spyOn(keys, "registerPublicKey").mockResolvedValue(TX);
        spyOn(keys, "hasPublicKey").mockResolvedValue(true);
        const local = keys.publicKeyFromPrivateKey(WALLET.viewPrivateKey as `0x${string}`);
        spyOn(keys, "getPublicKey").mockResolvedValue(local);

        const result = await registerActiveViewKey(CONFIG, WALLET);
        expect(result.status).toBe("success");
        expect(result.txHash).toBe(TX);
        expect(result.matchesViewKey).toBe(true);
        expect(result.registered).toBe(true);
        expect(result.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    });

    test("removeRegisteredPublicKey verifies the key is gone", async () => {
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(REGISTRY);
        spyOn(contracts, "getClients").mockReturnValue({
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "success" }),
            },
        } as never);
        spyOn(contracts, "getPublicKeyRegistryContract").mockReturnValue({
            write: { removePublicKey: async () => TX },
        } as never);
        const hasKey = spyOn(keys, "hasPublicKey");
        hasKey.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const result = await removeRegisteredPublicKey(CONFIG, WALLET);
        expect(result.status).toBe("success");
        expect(result.registered).toBe(false);
        expect(result.txHash).toBe(TX);
    });

    test("registerActiveViewKey fails when the receipt reverts", async () => {
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(REGISTRY);
        spyOn(contracts, "getClients").mockReturnValue({
            walletClient: {},
            publicClient: {
                waitForTransactionReceipt: async () => ({ status: "reverted" }),
            },
        } as never);
        spyOn(keys, "registerPublicKey").mockResolvedValue(TX);

        try {
            await registerActiveViewKey(CONFIG, WALLET);
            throw new Error("expected throw");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("TRANSACTION_REVERTED");
        }
    });
});
