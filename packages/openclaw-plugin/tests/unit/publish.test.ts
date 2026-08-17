import { beforeEach, describe, expect, test } from "bun:test";
import {
    CHANNEL,
    CONFIG,
    encryptedPublished,
    loadConfig,
    loadWallet,
    ORIGIN,
    publishAgentOutbound,
    publishChannelMessage,
    publishDeviceCommand,
    publishDeviceTelemetry,
    resolveAgent,
    resolveChannel,
    type ToolSpec,
    toolFactory,
    WALLET,
} from "./sdk-mock.ts";

async function loadPublishSpec() {
    const { publishTool } = await import("../../src/tools/publish.ts");
    return publishTool(toolFactory as never) as ToolSpec;
}

describe("smartclaws_publish", () => {
    beforeEach(() => {
        publishChannelMessage.mockClear();
        publishDeviceCommand.mockClear();
        publishDeviceTelemetry.mockClear();
        publishAgentOutbound.mockClear();
        resolveChannel.mockClear();
        resolveAgent.mockClear();
        loadConfig.mockClear();
        loadWallet.mockClear();
        publishDeviceTelemetry.mockImplementation(async () => encryptedPublished());
        publishDeviceCommand.mockImplementation(async () =>
            encryptedPublished({ topic: "command.switch.set" }),
        );
        publishAgentOutbound.mockImplementation(async () =>
            encryptedPublished({ topic: "decision.log", dev: "controller-1" }),
        );
        publishChannelMessage.mockImplementation(async () => encryptedPublished());
    });

    test("publishes device targets through SmartClawsDevice.publishTelemetry and waits by default", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            deviceAddress: "0x00000000000000000000000000000000000000d1",
        });
        const spec = await loadPublishSpec();

        const result = await spec.execute(
            { device: "sensor-1", topic: "telemetry.pm", payload: { pm25: 12 } },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveChannel).toHaveBeenCalledWith(
            { device: "sensor-1", channel: undefined },
            "/tmp/smartclaws-test",
        );
        expect(publishDeviceTelemetry).toHaveBeenCalledWith(
            {
                deviceAddress: "0x00000000000000000000000000000000000000d1",
                topic: "telemetry.pm",
                payload: { pm25: 12 },
                from: "sensor-1",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
        expect(publishChannelMessage).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            status: "published",
            encrypted: true,
            confirmedOffset: 9,
            callbackDeposit: "1066800",
        });
        expect(result).not.toHaveProperty("success");
    });

    test("wait:false is passed through; scheduled is not rewritten as published", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
            device: "sensor-1",
            deviceAddress: "0x00000000000000000000000000000000000000d1",
        });
        publishDeviceTelemetry.mockImplementation(async () =>
            encryptedPublished({
                status: "scheduled",
                confirmedOffset: undefined,
                ctxHashes: undefined,
            }),
        );
        const spec = await loadPublishSpec();

        const result = (await spec.execute(
            { device: "sensor-1", topic: "telemetry.pm", payload: { pm25: 12 }, wait: false },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(publishDeviceTelemetry).toHaveBeenCalledWith(expect.anything(), CONFIG, WALLET, {
            wait: false,
        });
        expect(result.status).toBe("scheduled");
        expect(result.status).not.toBe("published");
        expect(result).not.toHaveProperty("confirmedOffset");
        expect(result).not.toHaveProperty("success");
    });

    test("CTX timeout stays scheduled and is never rewritten as success", async () => {
        resolveChannel.mockReturnValue({ channelAddress: CHANNEL });
        publishChannelMessage.mockImplementation(async () =>
            encryptedPublished({
                status: "scheduled",
                confirmedOffset: undefined,
                ctxHashes: undefined,
            }),
        );
        const spec = await loadPublishSpec();

        const result = (await spec.execute(
            {
                channel: CHANNEL,
                topic: "telemetry.pm",
                payload: {},
                from: "controller",
            },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        )) as Record<string, unknown>;

        expect(result).toEqual({
            channel: CHANNEL,
            topic: "telemetry.pm",
            dev: "sensor-1",
            txHash: ORIGIN,
            status: "scheduled",
            encrypted: true,
            callbackDeposit: "1066800",
        });
        expect(result.status).not.toBe("published");
    });

    test("publishes device commands through SmartClawsDevice.publishCommand", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: "0x00000000000000000000000000000000000000c2",
            device: "shelly-plug-s",
            deviceAddress: "0x00000000000000000000000000000000000000d2",
        });
        const spec = await loadPublishSpec();

        const result = await spec.execute(
            {
                device: "shelly-plug-s",
                deviceChannel: "command",
                topic: "command.switch.set",
                payload: { on: true },
                from: "master-1",
            },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(publishDeviceCommand).toHaveBeenCalledWith(
            {
                deviceAddress: "0x00000000000000000000000000000000000000d2",
                topic: "command.switch.set",
                payload: { on: true },
                from: "master-1",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
        expect(publishDeviceTelemetry).not.toHaveBeenCalled();
        expect(result).toMatchObject({ status: "published", encrypted: true });
    });

    test("keeps direct channel targets on channel publishing", async () => {
        resolveChannel.mockReturnValue({
            channelAddress: CHANNEL,
        });
        const spec = await loadPublishSpec();

        await spec.execute(
            {
                channel: CHANNEL,
                topic: "command.switch.set",
                payload: { on: true },
                from: "controller",
            },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(publishChannelMessage).toHaveBeenCalledWith(
            {
                channelAddress: CHANNEL,
                topic: "command.switch.set",
                payload: { on: true },
                from: "controller",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
        expect(publishDeviceTelemetry).not.toHaveBeenCalled();
    });

    test("routes agent targets through publishAgentOutbound", async () => {
        resolveAgent.mockResolvedValue({
            name: "controller-1",
            agentContract: "0x00000000000000000000000000000000000000a1",
        });
        const spec = await loadPublishSpec();

        const result = await spec.execute(
            { agent: "controller-1", topic: "decision.log", payload: { decision: "hold" } },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveAgent).toHaveBeenCalledWith(
            "controller-1",
            CONFIG,
            WALLET,
            "/tmp/smartclaws-test",
        );
        expect(publishAgentOutbound).toHaveBeenCalledWith(
            {
                agentAddress: "0x00000000000000000000000000000000000000a1",
                topic: "decision.log",
                payload: { decision: "hold" },
                from: "controller-1",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
        expect(resolveChannel).not.toHaveBeenCalled();
        expect(result).toMatchObject({ status: "published", encrypted: true });
    });

    test("resolves raw agent addresses before outbound publishing", async () => {
        resolveAgent.mockResolvedValue({
            name: "controller-1",
            agentContract: "0x00000000000000000000000000000000000000a1",
        });
        const spec = await loadPublishSpec();

        await spec.execute(
            {
                agent: "0x00000000000000000000000000000000000000a1",
                topic: "decision.log",
                payload: { decision: "hold" },
            },
            { smartclawsHome: "/tmp/smartclaws-test" },
            {},
        );

        expect(resolveAgent).toHaveBeenCalledWith(
            "0x00000000000000000000000000000000000000a1",
            CONFIG,
            WALLET,
            "/tmp/smartclaws-test",
        );
        expect(publishAgentOutbound).toHaveBeenCalledWith(
            {
                agentAddress: "0x00000000000000000000000000000000000000a1",
                topic: "decision.log",
                payload: { decision: "hold" },
                from: "controller-1",
            },
            CONFIG,
            WALLET,
            { wait: true },
        );
    });
});
