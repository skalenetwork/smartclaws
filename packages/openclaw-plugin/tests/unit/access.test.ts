import { beforeEach, describe, expect, test } from "bun:test";
import {
    CONFIG,
    getAgentReaderStatus,
    getDeviceReaderStatus,
    listAgents,
    listDevices,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

const DEVICE = {
    name: "sensor-1",
    deviceContract: "0x00000000000000000000000000000000000000d1",
    incomingChannel: "0x00000000000000000000000000000000000000c2",
    outgoingChannel: "0x00000000000000000000000000000000000000c3",
    encrypted: true,
};

const PLAIN_DEVICE = {
    name: "plain-1",
    deviceContract: "0x00000000000000000000000000000000000000d0",
    incomingChannel: "0x00000000000000000000000000000000000000c0",
    outgoingChannel: "0x00000000000000000000000000000000000000c1",
    encrypted: false,
};

const AGENT = {
    name: "controller-1",
    agentContract: "0x00000000000000000000000000000000000000a1",
    incomingChannel: "0x00000000000000000000000000000000000000c4",
    outgoingChannel: "0x00000000000000000000000000000000000000c5",
    encrypted: true,
};

async function loadSpec() {
    const { accessTool } = await import("../../src/tools/access.ts");
    return accessTool(toolFactory as never) as ToolSpec;
}

async function run(params: Record<string, unknown> = {}) {
    const spec = await loadSpec();
    return (await spec.execute(params, { smartclawsHome: "/tmp/smartclaws-test" }, {})) as {
        account: string;
        entries: Array<Record<string, unknown>>;
    };
}

describe("smartclaws_access_check", () => {
    beforeEach(() => {
        getDeviceReaderStatus.mockClear();
        getAgentReaderStatus.mockClear();
        listDevices.mockClear();
        listAgents.mockClear();
        listDevices.mockReturnValue([]);
        listAgents.mockReturnValue([]);
        getDeviceReaderStatus.mockImplementation(async () => ({
            isIncomingReader: false,
            isOutgoingReader: true,
        }));
        getAgentReaderStatus.mockImplementation(async () => ({
            isIncomingReader: true,
            isOutgoingReader: true,
        }));
    });

    test("covers every known entity when no target is given", async () => {
        listDevices.mockReturnValue([DEVICE]);
        listAgents.mockReturnValue([AGENT]);

        const result = await run();

        expect(result.account).toBe(WALLET.address);
        expect(result.entries).toEqual([
            {
                kind: "device",
                name: "sensor-1",
                encrypted: true,
                incomingChannel: DEVICE.incomingChannel,
                outgoingChannel: DEVICE.outgoingChannel,
                canReadIncoming: false,
                canReadOutgoing: true,
            },
            {
                kind: "agent",
                name: "controller-1",
                encrypted: true,
                incomingChannel: AGENT.incomingChannel,
                outgoingChannel: AGENT.outgoingChannel,
                canReadIncoming: true,
                canReadOutgoing: true,
            },
        ]);
    });

    test("plain entities are included, because 'anyone can read this' is the answer", async () => {
        listDevices.mockReturnValue([PLAIN_DEVICE]);
        getDeviceReaderStatus.mockImplementation(async () => ({
            isIncomingReader: true,
            isOutgoingReader: true,
        }));

        const result = await run();

        // Skipping plain entities would report nothing about channels the wallet can
        // certainly read, which is a different claim from "no access".
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({
            name: "plain-1",
            encrypted: false,
            canReadIncoming: true,
            canReadOutgoing: true,
        });
    });

    test("a named device is checked alone, and agents are not walked", async () => {
        listDevices.mockReturnValue([DEVICE, PLAIN_DEVICE]);
        listAgents.mockReturnValue([AGENT]);

        const result = await run({ device: "sensor-1" });

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]?.name).toBe("sensor-1");
        expect(getDeviceReaderStatus).toHaveBeenCalledTimes(1);
        expect(getDeviceReaderStatus).toHaveBeenCalledWith(
            CONFIG,
            DEVICE.deviceContract,
            WALLET.address,
            "/tmp/smartclaws-test",
        );
        expect(getAgentReaderStatus).not.toHaveBeenCalled();
    });

    test("a device can be named by address as well as by local name", async () => {
        listDevices.mockReturnValue([DEVICE]);

        const result = await run({ device: DEVICE.deviceContract.toUpperCase() });

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]?.name).toBe("sensor-1");
    });

    test("rejects naming a device and an agent at once", async () => {
        listDevices.mockReturnValue([DEVICE]);
        listAgents.mockReturnValue([AGENT]);

        await expect(run({ device: "sensor-1", agent: "controller-1" })).rejects.toThrow(
            /not both/,
        );
    });

    test("an unknown name fails instead of silently reporting nothing", async () => {
        listDevices.mockReturnValue([DEVICE]);

        await expect(run({ device: "no-such-device" })).rejects.toThrow(/not found/);
    });
});
