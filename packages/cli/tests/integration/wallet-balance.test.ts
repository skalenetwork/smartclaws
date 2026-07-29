import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther, type Address } from "viem";
import { createClient, createDefaultConfig, generateWallet, saveConfig } from "@smartclaws/sdk";
import { publicClient, walletClient } from "../setup.ts";

const ANVIL_RPC = "http://127.0.0.1:8545";
const ANVIL_CHAIN_ID = 31337;

describe("wallet balance (anvil)", () => {
    let tempDir: string;
    let walletAddress: Address;

    beforeAll(() => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        process.env.SMARTCLAWS_HOME = tempDir;

        const config = createDefaultConfig("local", ANVIL_RPC, ANVIL_CHAIN_ID, "");
        saveConfig(config);

        const wallet = generateWallet();
        walletAddress = wallet.address as Address;
    });

    afterAll(() => {
        delete process.env.SMARTCLAWS_HOME;
        rmSync(tempDir, { recursive: true });
    });

    test("new wallet has zero balance", async () => {
        const balance = await publicClient.getBalance({ address: walletAddress });
        expect(balance).toBe(0n);
    });

    test("balance updates after receiving funds", async () => {
        const amount = parseEther("1.5");

        const hash = await walletClient.sendTransaction({
            to: walletAddress,
            value: amount,
        });
        await publicClient.waitForTransactionReceipt({ hash });

        const balance = await publicClient.getBalance({ address: walletAddress });
        expect(balance).toBe(amount);
    });

    test("balance readable via createClient from config", async () => {
        const config = createDefaultConfig("local", ANVIL_RPC, ANVIL_CHAIN_ID, "");
        const client = createClient(config);

        const balance = await client.getBalance({ address: walletAddress });
        expect(balance).toBe(parseEther("1.5"));
    });
});
