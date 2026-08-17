import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFile, Config, DeviceFile, GroupFile, WalletFile } from "@smartclaws/core/types";
import { saveAgent } from "../../src/agent.js";
import { ensureConfigDir } from "../../src/config.js";
import * as contracts from "../../src/contracts.js";
import { saveDevice } from "../../src/device.js";
import { SmartClawsError } from "../../src/errors.js";
import { saveGroup } from "../../src/group.js";
import {
    assertRegistrationKind,
    discoverDevices,
    discoverGroupsPage,
    enforceModeConstraints,
    hydrateDevice,
    hydrateGroup,
    mergeDeviceSets,
    resolveAgent,
    resolveDevice,
    resolveGroup,
} from "../../src/services/discovery.js";

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
        encrypted: false,
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
        encrypted: false,
    };
}

function expectSmartClawsCode(error: unknown, code: SmartClawsError["code"]): void {
    expect(error).toBeInstanceOf(SmartClawsError);
    expect((error as SmartClawsError).code).toBe(code);
}

describe("discovery resolution", () => {
    let tempDir: string;

    afterEach(() => {
        mock.restore();
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

describe("device-set merge and registration kind", () => {
    const plain = "0x00000000000000000000000000000000000000a1" as const;
    const encrypted = "0x00000000000000000000000000000000000000a2" as const;

    test("merges both sets, prefers encrypted on overlap, and counts the union", () => {
        const merged = mergeDeviceSets([plain, encrypted], [encrypted]);
        expect(merged.deviceCount).toBe(2);
        expect(merged.devices).toEqual([
            "0x00000000000000000000000000000000000000A2",
            "0x00000000000000000000000000000000000000A1",
        ]);
        expect(merged.plainDevices).toEqual(["0x00000000000000000000000000000000000000A1"]);
        expect(merged.plainDeviceCount).toBe(1);
        expect(merged.encryptedDevices).toEqual(["0x00000000000000000000000000000000000000A2"]);
        expect(merged.encryptedDeviceCount).toBe(1);
    });

    test("fails loudly when the registration event kind does not match the request", () => {
        expect(() => assertRegistrationKind(true, false)).toThrow(SmartClawsError);
        try {
            assertRegistrationKind(true, false);
        } catch (error) {
            expectSmartClawsCode(error, "REGISTRATION_KIND_MISMATCH");
        }
        expect(() => assertRegistrationKind(false, false)).not.toThrow();
    });
});

describe("encrypted discovery", () => {
    const plainDevice = "0x0000000000000000000000000000000000000031" as const;
    const encryptedDevice = "0x0000000000000000000000000000000000000032" as const;
    const incoming = "0x0000000000000000000000000000000000000100" as const;
    const outgoing = "0x0000000000000000000000000000000000000101" as const;
    let tempDir: string;

    function home(): string {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
        return tempDir;
    }

    afterEach(() => {
        mock.restore();
        contracts.clearContractCaches();
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("queries both device sets in parallel and merges the count", async () => {
        spyOn(contracts, "getDeviceGroupReadContract").mockReturnValue({
            read: {
                groupName: async () => "home",
                skills: async () => "temperature",
                createdAt: async () => 1n,
                owner: async () => WALLET.address,
                getDeviceCount: async () => 1n,
                getDevices: async () => [plainDevice],
                getEncryptedDeviceCount: async () => 1n,
                getEncryptedDevices: async () => [encryptedDevice],
            },
        } as never);

        const record = await hydrateGroup(
            "0x0000000000000000000000000000000000000011",
            CONFIG,
            undefined,
            home(),
        );
        expect(record.plainDeviceCount).toBe(1);
        expect(record.encryptedDeviceCount).toBe(1);
        expect(record.deviceCount).toBe(2);
        expect(record.encryptedDevices).toEqual(["0x0000000000000000000000000000000000000032"]);
    });

    test("hydration with provenance does not call isEncrypted", async () => {
        const isEncrypted = spyOn(contracts, "resolveChannelEncrypted");
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
            },
        } as never);

        const record = await hydrateDevice(encryptedDevice, CONFIG, undefined, home(), true);
        expect(record.encrypted).toBe(true);
        expect(isEncrypted).not.toHaveBeenCalled();
    });

    test("hydration without provenance queries isEncrypted and never defaults to plain", async () => {
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
                hasRole: async () => false,
            },
        } as never);
        const isEncrypted = spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
            read: { isAuthorizedReader: async () => true },
        } as never);

        const record = await hydrateDevice(encryptedDevice, CONFIG, WALLET, home());
        expect(isEncrypted).toHaveBeenCalled();
        expect(record.encrypted).toBe(true);
        expect(record.capabilities?.isIncomingReader).toBe(true);
        expect(record.capabilities?.isOutgoingReader).toBe(true);
    });

    test("hydration reads both channels, not just the incoming one", async () => {
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
                hasRole: async () => false,
            },
        } as never);
        const isEncrypted = spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);

        await hydrateDevice(plainDevice, CONFIG, undefined, home());

        const queried = isEncrypted.mock.calls.map((call) => call[0]);
        expect(queried).toContain(incoming);
        expect(queried).toContain(outgoing);
    });

    test("an entity whose channels disagree on kind fails instead of picking one", async () => {
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
                hasRole: async () => false,
            },
        } as never);
        // Unreachable today, but one `encrypted` flag cannot describe two kinds, and the
        // record feeds the decision to attach native value on publish.
        spyOn(contracts, "resolveChannelEncrypted").mockImplementation(
            async (address) => address === incoming,
        );

        await expect(hydrateDevice(encryptedDevice, CONFIG, undefined, home())).rejects.toThrow(
            /disagree on encryption/,
        );
    });

    test("provenance fills the record without seeding the channel-kind cache", async () => {
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
                hasRole: async () => false,
            },
        } as never);
        const remember = spyOn(contracts, "rememberChannelEncrypted");

        await hydrateDevice(encryptedDevice, CONFIG, undefined, home(), true);

        // A kind read off neither channel must not reach the cache that decides whether a
        // publish attaches native value; resolveChannelEncrypted fills it at first use.
        expect(remember).not.toHaveBeenCalled();
    });

    test("reader membership is not queried for plain channels", async () => {
        const readers = spyOn(contracts, "getEncryptedChannelReadContract");
        spyOn(contracts, "getDeviceContract").mockReturnValue({
            read: {
                deviceId: async () => "sensor",
                group: async () => "0x0000000000000000000000000000000000000011",
                createdAt: async () => 1n,
                getIncomingMessagesChannel: async () => incoming,
                getOutgoingMessagesChannel: async () => outgoing,
                hasRole: async () => false,
            },
        } as never);

        const record = await hydrateDevice(plainDevice, CONFIG, WALLET, home(), false);
        expect(record.encrypted).toBe(false);
        expect(readers).not.toHaveBeenCalled();
        expect(record.capabilities?.isIncomingReader).toBeUndefined();
    });

    test("discoverDevices carries kind provenance into hydration", async () => {
        spyOn(contracts, "getDeviceGroupReadContract").mockReturnValue({
            read: {
                getDeviceCount: async () => 1n,
                getDevices: async () => [plainDevice],
                getEncryptedDeviceCount: async () => 1n,
                getEncryptedDevices: async () => [encryptedDevice],
            },
        } as never);
        spyOn(contracts, "getDeviceContract").mockImplementation((address) => {
            const encrypted = address.toLowerCase() === encryptedDevice.toLowerCase();
            return {
                read: {
                    deviceId: async () => (encrypted ? "enc" : "plain"),
                    group: async () => "0x0000000000000000000000000000000000000011",
                    createdAt: async () => 1n,
                    getIncomingMessagesChannel: async () => incoming,
                    getOutgoingMessagesChannel: async () => outgoing,
                },
            } as never;
        });
        const isEncrypted = spyOn(contracts, "resolveChannelEncrypted");

        const devices = await discoverDevices(
            CONFIG,
            "0x0000000000000000000000000000000000000011",
            undefined,
            home(),
        );
        expect(devices.map((item) => item.encrypted).sort()).toEqual([false, true]);
        expect(isEncrypted).not.toHaveBeenCalled();
    });

    test("discoverGroupsPage hydrates only the requested window and enforces max page size", async () => {
        const groups = [
            "0x0000000000000000000000000000000000000011",
            "0x0000000000000000000000000000000000000012",
            "0x0000000000000000000000000000000000000013",
        ];
        spyOn(contracts, "getRegistryReadContract").mockReturnValue({
            read: {
                getDeviceGroupCount: async () => 3n,
                getDeviceGroups: async ([offset, limit]: [bigint, bigint]) =>
                    groups.slice(Number(offset), Number(offset) + Number(limit)),
            },
        } as never);
        spyOn(contracts, "getDeviceGroupReadContract").mockImplementation((address) => {
            return {
                read: {
                    groupName: async () => `g-${address.slice(-2)}`,
                    skills: async () => "",
                    createdAt: async () => 1n,
                    owner: async () => WALLET.address,
                    getDeviceCount: async () => 0n,
                    getDevices: async () => [],
                    getEncryptedDeviceCount: async () => 0n,
                    getEncryptedDevices: async () => [],
                },
            } as never;
        });

        const page = await discoverGroupsPage(CONFIG, { offset: 1, limit: 1, homeDir: home() });
        expect(page.total).toBe(3);
        expect(page.items).toHaveLength(1);
        expect(page.nextOffset).toBe(2);
        await expect(discoverGroupsPage(CONFIG, { offset: 0, limit: 101 })).rejects.toThrow(
            /cannot exceed/,
        );
    });
});
