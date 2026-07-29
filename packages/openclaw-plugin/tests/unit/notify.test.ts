import { beforeEach, describe, expect, mock, test } from "bun:test";

const CONFIG = {
    version: 2,
    network: "local",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    contractAddress: "0x0000000000000000000000000000000000000001",
    walletAddress: "0x0000000000000000000000000000000000000002",
    mode: "controller",
    deviceGroupAddress: "",
    attachedGroupAddress: "",
    attachedAgentAddress: "",
    attachedDeviceAddresses: [],
};

const WALLET = {
    address: "0x0000000000000000000000000000000000000002",
    privateKey: "0x01",
};

const publishAgentInbound = mock(async (params) => ({ kind: "inbound", ...params }));
const publishAgentOutbound = mock(async (params) => ({ kind: "agent", ...params }));
const publishChannelMessage = mock(async (params) => ({ kind: "channel", ...params }));
const publishDeviceTelemetry = mock(async (params) => ({ kind: "device", ...params }));
const publishDeviceCommand = mock(async (params) => ({ kind: "command", ...params }));
const resolveChannel = mock();
const resolveAgent = mock();
const loadAgent = mock();
const loadConfig = mock(() => CONFIG);
const loadWallet = mock(() => WALLET);

// The mock is a superset of every @smartclaws/sdk export used by the plugin
// tools, because bun's module mocks are shared across test files.
mock.module("@smartclaws/sdk", () => ({
    SmartClawsError: class SmartClawsError extends Error {
        code: string;
        details?: Record<string, unknown>;

        constructor(code: string, message: string, details?: Record<string, unknown>) {
            super(message);
            this.name = "SmartClawsError";
            this.code = code;
            this.details = details;
        }
    },
    createDefaultConfig: mock(() => CONFIG),
    loadConfig,
    loadWallet,
    loadAgent,
    publishAgentInbound,
    publishAgentOutbound,
    publishChannelMessage,
    publishDeviceTelemetry,
    publishDeviceCommand,
    resolveAgent,
    resolveChannel,
}));

function toolFactory(spec: unknown): unknown {
    return spec;
}

async function loadNotifySpec() {
    const { notifyTool } = await import("../../src/tools/notify.ts");
    return notifyTool(toolFactory as never) as {
        execute: (
            params: Record<string, unknown>,
            config: Record<string, unknown>,
            context: { signal?: AbortSignal },
        ) => Promise<unknown>;
    };
}

describe("smartclaws_notify", () => {
    beforeEach(() => {
        publishAgentInbound.mockClear();
        loadAgent.mockClear();
        loadConfig.mockClear();
        loadWallet.mockClear();
    });

    test("publishes to a named agent's incoming channel", async () => {
        loadAgent.mockReturnValue({
            name: "worker-1",
            agentContract: "0x00000000000000000000000000000000000000a2",
        });
        const spec = await loadNotifySpec();

        const result = await spec.execute(
            { agent: "worker-1", topic: "task.assign", payload: { job: 7 }, from: "controller" },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
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
        );
        expect(result).toMatchObject({ kind: "inbound" });
    });

    test("falls back to a raw 0x address when no local record exists", async () => {
        loadAgent.mockReturnValue(null);
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

        expect(publishAgentInbound).toHaveBeenCalledWith(
            {
                agentAddress: "0x00000000000000000000000000000000000000a3",
                topic: "task.assign",
                payload: {},
                from: "controller",
            },
            CONFIG,
            WALLET,
        );
    });
});
