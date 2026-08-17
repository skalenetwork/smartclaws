import { describe, expect, test } from "bun:test";
import {
    assertNotSelfLockout,
    grantDevicePermission,
    grantDeviceReader,
    ORIGIN,
    revokeDevicePermission,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";
const ACCOUNT = "0x00000000000000000000000000000000000000aa";

describe("smartclaws_role_grant", () => {
    test("rejects invalid cross-kind roles before RPC", async () => {
        grantDevicePermission.mockClear();
        const { roleGrantTool } = await import("../../src/tools/roles.ts");
        const spec = roleGrantTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_role_grant");
        expect(spec.optional).toBe(true);
        await expect(
            spec.execute(
                { kind: "device", target: "sensor-1", role: "sender", account: ACCOUNT },
                { smartclawsHome: HOME },
                {},
            ),
        ).rejects.toThrow(/Device roles/);
        expect(grantDevicePermission).not.toHaveBeenCalled();
    });

    test("grants a device publisher role", async () => {
        const { roleGrantTool } = await import("../../src/tools/roles.ts");
        const spec = roleGrantTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute(
            { kind: "device", target: "sensor-1", role: "publisher", account: ACCOUNT },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(grantDevicePermission).toHaveBeenCalled();
        expect(result.status).toBe("confirmed");
        expect(result.txHash).toBe(ORIGIN);
        expect(result.role).toBe("publisher");
    });
});

describe("smartclaws_role_revoke", () => {
    test("refuses self-revocation of master without the explicit flag", async () => {
        const { roleRevokeTool } = await import("../../src/tools/roles.ts");
        const spec = roleRevokeTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        await expect(
            spec.execute(
                { kind: "device", target: "sensor-1", role: "master", account: WALLET.address },
                { smartclawsHome: HOME },
                {},
            ),
        ).rejects.toThrow(/allowSelfRevocation/);
        expect(assertNotSelfLockout).toHaveBeenCalled();
        expect(revokeDevicePermission).not.toHaveBeenCalled();
    });
});

describe("smartclaws_reader_grant", () => {
    test("grants a device reader and returns the channel", async () => {
        const { readerGrantTool } = await import("../../src/tools/readers.ts");
        const spec = readerGrantTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_reader_grant");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { kind: "device", target: "sensor-1", side: "outgoing", account: ACCOUNT },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(grantDeviceReader).toHaveBeenCalled();
        expect(result.status).toBe("confirmed");
        expect(result.channel).toBe("0x00000000000000000000000000000000000000c3");
    });
});
