import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, decodeEventLog, keccak256, toHex } from "viem";
import { createDefaultConfig, loadDevice, saveConfig } from "@smartclaws/sdk";
import {
    account,
    deployRegistry,
    getChannelContract,
    publicClient,
    walletClient,
} from "../setup.ts";
import SmartClawsABI from "@smartclaws/core/abi/SmartClaws.json";
import SmartClawsDeviceABI from "@smartclaws/core/abi/SmartClawsDevice.json";
import SmartClawsDeviceGroupABI from "@smartclaws/core/abi/SmartClawsDeviceGroup.json";
import { getContract } from "viem";

const ANVIL_RPC = "http://127.0.0.1:8545";
const ANVIL_CHAIN_ID = 31337;
const PUBLISHER_ROLE = keccak256(toHex("PUBLISHER_ROLE"));

describe("register & device (anvil)", () => {
    let tempDir: string;
    let registryAddress: Address;
    let groupAddress: Address;
    let deviceAddress: Address;

    beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        process.env.SMARTCLAWS_HOME = tempDir;

        registryAddress = await deployRegistry();

        const config = createDefaultConfig("local", ANVIL_RPC, ANVIL_CHAIN_ID, registryAddress);
        saveConfig(config);
    });

    afterAll(() => {
        delete process.env.SMARTCLAWS_HOME;
        rmSync(tempDir, { recursive: true });
    });

    test("register device group", async () => {
        const registry = getContract({
            address: registryAddress,
            abi: SmartClawsABI.abi,
            client: { public: publicClient, wallet: walletClient },
        });

        const hash = await registry.write.registerDeviceGroup(["test-group", "temperature"]);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
            try {
                const decoded = decodeEventLog({
                    abi: SmartClawsABI.abi,
                    data: log.data,
                    topics: log.topics,
                });
                if (decoded.eventName === "DeviceGroupRegistered") {
                    groupAddress = (decoded.args as unknown as { deviceGroup: Address })
                        .deviceGroup;
                }
            } catch {}
        }

        expect(groupAddress).toBeDefined();
        expect(groupAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test("register device in group", async () => {
        const group = getContract({
            address: groupAddress,
            abi: SmartClawsDeviceGroupABI.abi,
            client: { public: publicClient, wallet: walletClient },
        });

        const hash = await group.write.registerDevice([
            "temp-sensor-01",
            account.address,
            BigInt(1024 * 1024),
        ]);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== groupAddress.toLowerCase()) continue;
            try {
                const decoded = decodeEventLog({
                    abi: SmartClawsDeviceGroupABI.abi,
                    data: log.data,
                    topics: log.topics,
                });
                if (decoded.eventName === "DeviceRegistered") {
                    deviceAddress = (decoded.args as unknown as { device: Address }).device;
                }
            } catch {}
        }

        expect(deviceAddress).toBeDefined();
        expect(deviceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test("device has correct channels", async () => {
        const device = getContract({
            address: deviceAddress,
            abi: SmartClawsDeviceABI.abi,
            client: publicClient,
        });

        const incoming = await device.read.getIncomingMessagesChannel();
        const outgoing = await device.read.getOutgoingMessagesChannel();
        const deviceId = await device.read.deviceId();

        expect(incoming).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(outgoing).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(deviceId).toBe("temp-sensor-01");
    });

    test("can publish to device outgoing channel", async () => {
        const device = getContract({
            address: deviceAddress,
            abi: SmartClawsDeviceABI.abi,
            client: { public: publicClient, wallet: walletClient },
        });

        const grantHash = await device.write.grantRole([PUBLISHER_ROLE, account.address]);
        await publicClient.waitForTransactionReceipt({ hash: grantHash });

        const outgoingAddress = (await device.read.getOutgoingMessagesChannel()) as Address;
        const channel = getChannelContract(outgoingAddress);

        const payload =
            `0x${Buffer.from('{"v":1,"ts":1711324800,"dev":"temp-01","topic":"temperature","p":{"temp":24.5}}').toString("hex")}` as `0x${string}`;

        const hash = await device.write.publishTelemetry([payload]);
        await publicClient.waitForTransactionReceipt({ hash });

        const count = await channel.read.getMessageCount();
        expect(count).toBe(1n);
    });
});
