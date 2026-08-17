import { beforeEach, describe, expect, test } from "bun:test";
import {
    getSetupStatus,
    listAgentReaders,
    listAgents,
    listDeviceReaders,
    listDevices,
    listGroups,
    listPresentedBackups,
    type ToolSpec,
    toolFactory,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";

describe("smartclaws_setup_status", () => {
    test("is registered by name and stays non-optional", async () => {
        const { setupStatusTool } = await import("../../src/tools/setup-status.ts");
        const spec = setupStatusTool(toolFactory as never) as ToolSpec & { optional?: boolean };
        expect(spec.name).toBe("smartclaws_setup_status");
        expect(spec.optional).not.toBe(true);
        await spec.execute({}, { smartclawsHome: HOME }, {});
        expect(getSetupStatus).toHaveBeenCalledWith({
            homeDir: HOME,
            overrides: {
                network: undefined,
                rpcUrl: undefined,
                chainId: undefined,
                registryAddress: undefined,
            },
        });
    });
});

describe("smartclaws_list_local", () => {
    beforeEach(() => {
        listGroups.mockReturnValue([
            {
                name: "home",
                groupAddress: "0x0000000000000000000000000000000000000011",
                owner: "0xabc",
            },
        ]);
        listDevices.mockReturnValue([]);
        listAgents.mockReturnValue([]);
    });

    test("returns local records without filesystem paths", async () => {
        const { listLocalTool } = await import("../../src/tools/list-local.ts");
        const spec = listLocalTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute({ kind: "group" }, { smartclawsHome: HOME }, {})) as {
            groups: Array<Record<string, unknown>>;
        };
        expect(spec.name).toBe("smartclaws_list_local");
        expect(listGroups).toHaveBeenCalledWith(HOME);
        expect(result.groups[0]?.address).toBe("0x0000000000000000000000000000000000000011");
        expect(JSON.stringify(result)).not.toContain(HOME);
        expect(JSON.stringify(result)).not.toContain("privateKey");
    });
});

describe("smartclaws_backup_list", () => {
    test("omits paths from backup listings", async () => {
        listPresentedBackups.mockReturnValue([
            {
                name: "backup-20260101-000000Z",
                createdAt: "2026-01-01T00:00:00.000Z",
                sizeBytes: 12,
                fingerprint: "aa".repeat(32),
            },
        ]);
        const { backupListTool } = await import("../../src/tools/backups.ts");
        const spec = backupListTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute({}, { smartclawsHome: HOME }, {})) as {
            backups: Array<Record<string, unknown>>;
        };
        expect(spec.name).toBe("smartclaws_backup_list");
        expect(result.backups[0]).not.toHaveProperty("path");
        expect(JSON.stringify(result)).not.toContain(HOME);
    });
});

describe("smartclaws_reader_list", () => {
    test("lists device readers through the SDK", async () => {
        listDeviceReaders.mockResolvedValue(["0x0000000000000000000000000000000000000002"]);
        const { readerListTool } = await import("../../src/tools/readers.ts");
        const spec = readerListTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute(
            { kind: "device", target: "sensor-1", side: "outgoing" },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(spec.name).toBe("smartclaws_reader_list");
        expect(listDeviceReaders).toHaveBeenCalled();
        expect(listAgentReaders).not.toHaveBeenCalled();
        expect(result.channel).toBe("0x00000000000000000000000000000000000000c3");
        expect(result.encrypted).toBe(true);
        expect(result.readers).toEqual(["0x0000000000000000000000000000000000000002"]);
    });
});
