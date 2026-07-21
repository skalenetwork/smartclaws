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

const publishChannelMessage = mock(async (params) => ({ kind: "channel", ...params }));
const publishDeviceTelemetry = mock(async (params) => ({ kind: "device", ...params }));
const publishDeviceCommand = mock(async (params) => ({ kind: "command", ...params }));
const publishAgentOutbound = mock(async (params) => ({ kind: "agent", ...params }));
const publishAgentInbound = mock(async (params) => ({ kind: "inbound", ...params }));
const resolveChannel = mock();
const resolveAgent = mock();
const loadAgent = mock();
const loadConfig = mock(() => CONFIG);
const loadWallet = mock(() => WALLET);

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
  publishChannelMessage,
  publishDeviceCommand,
  publishDeviceTelemetry,
  publishAgentOutbound,
  publishAgentInbound,
  resolveAgent,
  resolveChannel,
}));

function toolFactory(spec: unknown): unknown {
  return spec;
}

async function loadPublishSpec() {
  const { publishTool } = await import("../../src/tools/publish.ts");
  return publishTool(toolFactory as never) as {
    execute: (
      params: Record<string, unknown>,
      config: Record<string, unknown>,
      context: { signal?: AbortSignal },
    ) => Promise<unknown>;
  };
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
  });

  test("publishes device targets through SmartClawsDevice.publishTelemetry", async () => {
    resolveChannel.mockReturnValue({
      channelAddress: "0x00000000000000000000000000000000000000c1",
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
    );
    expect(publishChannelMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "device" });
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
    );
    expect(publishDeviceTelemetry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "command" });
  });

  test("keeps direct channel targets on channel publishing", async () => {
    resolveChannel.mockReturnValue({
      channelAddress: "0x00000000000000000000000000000000000000c1",
    });
    const spec = await loadPublishSpec();

    await spec.execute(
      {
        channel: "0x00000000000000000000000000000000000000c1",
        topic: "command.switch.set",
        payload: { on: true },
        from: "controller",
      },
      { smartclawsHome: "/tmp/smartclaws-test" },
      {},
    );

    expect(publishChannelMessage).toHaveBeenCalledWith(
      {
        channelAddress: "0x00000000000000000000000000000000000000c1",
        topic: "command.switch.set",
        payload: { on: true },
        from: "controller",
      },
      CONFIG,
      WALLET,
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
    );
    expect(resolveChannel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "agent" });
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
    );
  });
});
