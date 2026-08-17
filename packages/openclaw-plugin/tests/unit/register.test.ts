import { beforeEach, describe, expect, test } from "bun:test";
import {
    attachHomeEntities,
    MockSmartClawsError,
    ORIGIN,
    registerAgentWithResult,
    registerDeviceWithResult,
    registerGroupWithResult,
    resolveGroup,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";
const GROUP = "0x0000000000000000000000000000000000000011";

describe("smartclaws_register_group", () => {
    beforeEach(() => {
        registerGroupWithResult.mockClear();
        attachHomeEntities.mockClear();
    });

    test("registers a named group, waits, and attaches by default", async () => {
        const { registerGroupTool } = await import("../../src/tools/register-group.ts");
        const spec = registerGroupTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_register_group");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { name: "home" },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(registerGroupWithResult).toHaveBeenCalled();
        expect(attachHomeEntities).toHaveBeenCalled();
        expect(result.status).toBe("confirmed");
        expect(result.txHash).toBe(ORIGIN);
        expect(result.attached).toBe(true);
        expect(JSON.stringify(result)).not.toContain("privateKey");
    });

    test("skips attachment when attach is false", async () => {
        const { registerGroupTool } = await import("../../src/tools/register-group.ts");
        const spec = registerGroupTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute(
            { name: "home", attach: false },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(attachHomeEntities).not.toHaveBeenCalled();
        expect(result.attached).toBe(false);
    });

    test("surfaces LOCAL_STATE_SAVE_FAILED with address and txHash", async () => {
        attachHomeEntities.mockRejectedValueOnce(new Error("disk full"));
        const { registerGroupTool } = await import("../../src/tools/register-group.ts");
        const spec = registerGroupTool(toolFactory as never) as ToolSpec;
        try {
            await spec.execute({ name: "home" }, { smartclawsHome: HOME }, {});
            throw new Error("expected failure");
        } catch (error) {
            expect((error as { code?: string }).code).toBe("LOCAL_STATE_SAVE_FAILED");
            expect((error as { details?: Record<string, unknown> }).details).toMatchObject({
                txHash: ORIGIN,
                address: GROUP,
                kind: "group",
            });
        }
    });

    test("returns confirmed with a recovery step when mode attachment is incomplete", async () => {
        attachHomeEntities.mockRejectedValueOnce(
            new MockSmartClawsError(
                "MODE_CONSTRAINT",
                "master-agent mode requires exactly one agent.",
            ),
        );
        const { registerGroupTool } = await import("../../src/tools/register-group.ts");
        const spec = registerGroupTool(toolFactory as never) as ToolSpec;
        const result = (await spec.execute(
            { name: "home" },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;

        expect(result.status).toBe("confirmed");
        expect(result.attached).toBe(false);
        expect(result.attachmentIssue).toEqual({
            code: "MODE_CONSTRAINT",
            message: "master-agent mode requires exactly one agent.",
            recommendedTool: "smartclaws_attach",
        });
    });
});

describe("smartclaws_register_device", () => {
    beforeEach(() => {
        registerDeviceWithResult.mockClear();
        resolveGroup.mockClear();
        attachHomeEntities.mockClear();
    });

    test("verifies the group and passes capacity as bigint", async () => {
        const { registerDeviceTool } = await import("../../src/tools/register-device.ts");
        const spec = registerDeviceTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { name: "sensor-1", group: "home", capacityBytes: "1048576" },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(resolveGroup).toHaveBeenCalled();
        expect(registerDeviceWithResult).toHaveBeenCalledWith(
            expect.anything(),
            WALLET,
            GROUP,
            "sensor-1",
            1048576n,
            HOME,
            { encrypted: false },
        );
        expect(result.status).toBe("confirmed");
        expect((result.device as { incomingChannel: string }).incomingChannel).toBeDefined();
    });
});

describe("smartclaws_register_agent", () => {
    test("registers an agent with a stable name", async () => {
        const { registerAgentTool } = await import("../../src/tools/register-agent.ts");
        const spec = registerAgentTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_register_agent");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { name: "controller-1", attach: false },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(registerAgentWithResult).toHaveBeenCalled();
        expect(result.status).toBe("confirmed");
        expect(result.attached).toBe(false);
    });
});
