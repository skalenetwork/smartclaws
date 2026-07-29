import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFile, Config, DeviceFile, GroupFile, WalletFile } from "@smartclaws/core/types";
import { ensureConfigDir } from "../../src/config.js";
import { saveAgent } from "../../src/agent.js";
import { saveDevice } from "../../src/device.js";
import { SmartClawsError } from "../../src/errors.js";
import { saveGroup } from "../../src/group.js";
import {
    enforceModeConstraints,
    resolveAgent,
    resolveDevice,
    resolveGroup,
} from "../../src/services/discovery.js";

const CONFIG: Config = {
    version: 2,
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

function group(address: string, name: string): GroupFile {
    return {
        name,
        groupAddress: address,
        skills: "temperature",
        createdAt: 1711324800,
        owner: WALLET.address,
        deviceCount: 0,
        devices: [],
    };
}

function device(address: string, name: string, groupAddress: string): DeviceFile {
    return {
        name,
        deviceContract: address,
        groupAddress,
        createdAt: 1711324800,
        incomingChannel: "0x0000000000000000000000000000000000000100",
        outgoingChannel: "0x0000000000000000000000000000000000000101",
    };
}

function agent(address: string, name: string): AgentFile {
    return {
        name,
        agentId: name,
        metadata: "bridge",
        agentContract: address,
        incomingChannel: "0x0000000000000000000000000000000000000200",
        outgoingChannel: "0x0000000000000000000000000000000000000201",
        owner: WALLET.address,
        createdAt: 1711324800,
    };
}

function expectSmartClawsCode(error: unknown, code: SmartClawsError["code"]): void {
    expect(error).toBeInstanceOf(SmartClawsError);
    expect((error as SmartClawsError).code).toBe(code);
}

describe("discovery resolution", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("resolves a group by local cache name", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        ensureConfigDir(tempDir);
        saveGroup(group("0x0000000000000000000000000000000000000011", "home"), tempDir);

        const resolved = await resolveGroup("home", CONFIG, WALLET, tempDir);
        expect(resolved.groupAddress).toBe("0x0000000000000000000000000000000000000011");
    });

    test("fails ambiguous local group names with options", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        ensureConfigDir(tempDir);
        saveGroup(group("0x0000000000000000000000000000000000000011", "home"), tempDir);
        saveGroup(group("0x0000000000000000000000000000000000000012", "home"), tempDir);

        try {
            await resolveGroup("home", CONFIG, WALLET, tempDir);
            throw new Error("expected throw");
        } catch (error) {
            expectSmartClawsCode(error, "AMBIGUOUS_ENTITY");
            expect((error as SmartClawsError).details?.matches).toBeArrayOfSize(2);
        }
    });

    test("resolves a device by local cache name inside a group", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        ensureConfigDir(tempDir);
        const groupAddress = "0x0000000000000000000000000000000000000011";
        saveDevice(
            device("0x0000000000000000000000000000000000000031", "sensor", groupAddress),
            tempDir,
        );

        const resolved = await resolveDevice("sensor", CONFIG, WALLET, tempDir, groupAddress);
        expect(resolved.deviceContract).toBe("0x0000000000000000000000000000000000000031");
    });

    test("fails ambiguous local device names", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        ensureConfigDir(tempDir);
        const dir = join(tempDir, "devices");
        writeFileSync(
            join(dir, "first.json"),
            JSON.stringify(
                device(
                    "0x0000000000000000000000000000000000000031",
                    "sensor",
                    "0x0000000000000000000000000000000000000011",
                ),
            ),
        );
        writeFileSync(
            join(dir, "second.json"),
            JSON.stringify(
                device(
                    "0x0000000000000000000000000000000000000032",
                    "sensor",
                    "0x0000000000000000000000000000000000000012",
                ),
            ),
        );

        try {
            await resolveDevice("sensor", CONFIG, WALLET, tempDir);
            throw new Error("expected throw");
        } catch (error) {
            expectSmartClawsCode(error, "AMBIGUOUS_ENTITY");
        }
    });

    test("resolves an agent by local cache id", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        ensureConfigDir(tempDir);
        saveAgent(agent("0x0000000000000000000000000000000000000041", "bridge-a"), tempDir);

        const resolved = await resolveAgent("bridge-a", CONFIG, WALLET, tempDir);
        expect(resolved.agentContract).toBe("0x0000000000000000000000000000000000000041");
    });
});

describe("mode constraints", () => {
    const groupRecord = group("0x0000000000000000000000000000000000000011", "home");
    const deviceRecord = device(
        "0x0000000000000000000000000000000000000031",
        "sensor",
        groupRecord.groupAddress,
    );
    const agentRecord = agent("0x0000000000000000000000000000000000000041", "bridge-a");

    test("controller rejects agent attachments", () => {
        expect(() => enforceModeConstraints("controller", { agent: agentRecord })).toThrow();
    });

    test("bridge-agent requires one agent and exactly one device", () => {
        expect(() =>
            enforceModeConstraints("bridge-agent", { agent: agentRecord, devices: [] }),
        ).toThrow();
        expect(() =>
            enforceModeConstraints("bridge-agent", { agent: agentRecord, devices: [deviceRecord] }),
        ).not.toThrow();
    });

    test("master-agent requires one agent, one group, and devices from that group", () => {
        expect(() =>
            enforceModeConstraints("master-agent", { agent: agentRecord, devices: [deviceRecord] }),
        ).toThrow();
        expect(() =>
            enforceModeConstraints("master-agent", {
                agent: agentRecord,
                group: groupRecord,
                devices: [
                    device(
                        "0x0000000000000000000000000000000000000032",
                        "other",
                        "0x0000000000000000000000000000000000000099",
                    ),
                ],
            }),
        ).toThrow();
        expect(() =>
            enforceModeConstraints("master-agent", {
                agent: agentRecord,
                group: groupRecord,
                devices: [deviceRecord],
            }),
        ).not.toThrow();
    });
});
