import { beforeEach, describe, expect, test } from "bun:test";
import {
    CONFIG,
    discoverAgentsPage,
    discoverDevicesPage,
    discoverGroupsPage,
    getAgentReaderStatus,
    getDeviceReaderStatus,
    listAgents,
    listDevices,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";

describe("smartclaws_access_check", () => {
    beforeEach(() => {
        getDeviceReaderStatus.mockClear();
        getAgentReaderStatus.mockClear();
        listDevices.mockReturnValue([
            {
                name: "sensor-1",
                deviceContract: "0x00000000000000000000000000000000000000d1",
                incomingChannel: "0x00000000000000000000000000000000000000c2",
                outgoingChannel: "0x00000000000000000000000000000000000000c3",
                encrypted: true,
            },
            {
                name: "sensor-2",
                deviceContract: "0x00000000000000000000000000000000000000d2",
                incomingChannel: "0x00000000000000000000000000000000000000c4",
                outgoingChannel: "0x00000000000000000000000000000000000000c5",
                encrypted: false,
            },
        ]);
        listAgents.mockReturnValue([]);
        getDeviceReaderStatus.mockResolvedValue({
            isIncomingReader: true,
            isOutgoingReader: false,
        });
    });

    test("pages untargeted checks and keeps targeted lookup cheap", async () => {
        const { accessTool } = await import("../../src/tools/access.ts");
        const spec = accessTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_access_check");
        expect(spec.optional).not.toBe(true);

        const page = (await spec.execute(
            { offset: 0, limit: 1 },
            { smartclawsHome: HOME },
            {},
        )) as { total: number; nextOffset: number | null; entries: unknown[] };
        expect(page.total).toBe(2);
        expect(page.entries).toHaveLength(1);
        expect(page.nextOffset).toBe(1);
        expect(getDeviceReaderStatus).toHaveBeenCalledTimes(1);

        getDeviceReaderStatus.mockClear();
        await spec.execute({ device: "sensor-2" }, { smartclawsHome: HOME }, {});
        expect(getDeviceReaderStatus).toHaveBeenCalledTimes(1);
        expect(getAgentReaderStatus).not.toHaveBeenCalled();
    });
});

describe("smartclaws_discover", () => {
    test("discovers a bounded group page through the SDK", async () => {
        discoverGroupsPage.mockResolvedValue({
            total: 2,
            offset: 0,
            limit: 1,
            nextOffset: 1,
            items: [
                {
                    name: "home",
                    groupAddress: "0x0000000000000000000000000000000000000011",
                    owner: WALLET.address,
                    skills: "",
                    deviceCount: 0,
                },
            ],
        });
        const { discoverTool } = await import("../../src/tools/discover.ts");
        const spec = discoverTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_discover");
        const result = (await spec.execute(
            { kind: "group", offset: 0, limit: 1 },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(discoverGroupsPage).toHaveBeenCalledWith(CONFIG, {
            offset: 0,
            limit: 1,
            wallet: undefined,
            homeDir: HOME,
        });
        expect(discoverDevicesPage).not.toHaveBeenCalled();
        expect(discoverAgentsPage).not.toHaveBeenCalled();
        expect(result.nextOffset).toBe(1);
        expect(JSON.stringify(result)).not.toContain("privateKey");
    });
});
