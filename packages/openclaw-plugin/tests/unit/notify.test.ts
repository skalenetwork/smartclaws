import { beforeEach, describe, expect, test } from "bun:test";
import {
    CONFIG,
    encryptedPublished,
    loadConfig,
    loadWallet,
    publishAgentInbound,
    resolveAgent,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

async function loadNotifySpec() {
    const { notifyTool } = await import("../../src/tools/notify.ts");
    return notifyTool(toolFactory as never) as ToolSpec;
}

describe("smartclaws_notify", () => {
    beforeEach(() => {
        publishAgentInbound.mockClear();
        resolveAgent.mockClear();
        loadConfig.mockClear();
        loadWallet.mockClear();
        resolveAgent.mockResolvedValue({
            name: "worker-1",
            agentContract: "0x00000000000000000000000000000000000000a2",
        });
        publishAgentInbound.mockImplementation(async () =>
            encryptedPublished({ topic: "task.assign", dev: "controller" }),
        );
    });

    test("publishes to a named agent's incoming channel and waits by default", async () => {
        const spec = await loadNotifySpec();

        const result = await spec.execute(
            { agent: "worker-1", topic: "task.assign", payload: { job: 7 }, from: "controller" },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveAgent).toHaveBeenCalledWith(
            "worker-1",
            CONFIG,
            WALLET,
            "/tmp/smartclaws-test",
        );
        expect(publishAgentInbound).toHaveBeenCalledWith(
            {
                agentAddress: "0x00000000000000000000000000000000000000a2",
                topic: "task.assign",
                payload: { job: 7 },
                from: "controller",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
        expect(result).toMatchObject({
            status: "published",
            encrypted: true,
            callbackDeposit: "1066800",
        });
        expect(result).not.toHaveProperty("success");
    });

    test("wait:false scheduled notify is not rewritten as published", async () => {
        publishAgentInbound.mockImplementation(async () =>
            encryptedPublished({
                topic: "task.assign",
                dev: "controller",
                status: "scheduled",
                confirmedOffset: undefined,
                ctxHashes: undefined,
            }),
        );
        const spec = await loadNotifySpec();

        const result = (await spec.execute(
            { agent: "worker-1", topic: "task.assign", payload: { job: 7 }, wait: false },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(publishAgentInbound).toHaveBeenCalledWith(expect.anything(), CONFIG, WALLET, {
            wait: false,
        });
        expect(result.status).toBe("scheduled");
        expect(result.status).not.toBe("published");
        expect(result).not.toHaveProperty("success");
    });

    test("resolves raw addresses through resolveAgent, not a local-only fallback", async () => {
        resolveAgent.mockResolvedValue({
            name: "remote",
            agentContract: "0x00000000000000000000000000000000000000a3",
        });
        const spec = await loadNotifySpec();

        await spec.execute(
            {
                agent: "0x00000000000000000000000000000000000000a3",
                topic: "task.assign",
                payload: {},
            },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveAgent).toHaveBeenCalledWith(
            "0x00000000000000000000000000000000000000a3",
            CONFIG,
            WALLET,
            "/tmp/smartclaws-test",
        );
        expect(publishAgentInbound).toHaveBeenCalledWith(
            {
                agentAddress: "0x00000000000000000000000000000000000000a3",
                topic: "task.assign",
                payload: {},
                from: "controller",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
    });
});
