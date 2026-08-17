import { mock } from "bun:test";
import type { PublishResult } from "@smartclaws/sdk";

export const CONFIG = {
    version: 3 as const,
    network: "local",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    contractAddress: "0x0000000000000000000000000000000000000001",
    walletAddress: "0x0000000000000000000000000000000000000002",
    mode: "controller" as const,
    deviceGroupAddress: "",
    attachedGroupAddress: "",
    attachedAgentAddress: "",
    attachedDeviceAddresses: [],
};

export const WALLET = {
    address: "0x0000000000000000000000000000000000000002",
    privateKey: "0x01",
};

export const CHANNEL = "0x00000000000000000000000000000000000000c1";
export const ORIGIN = `0x${"01".repeat(32)}`;
export const CTX_HASH = `0x${"ab".repeat(32)}`;
export const CALLBACK_DEPOSIT = 152_400n * 7n;

/** Matches the SDK encrypted-publish success shape (Track 3C + FakeEncryptionProvider). */
export function encryptedPublished(overrides: Partial<PublishResult> = {}): PublishResult {
    return {
        channel: CHANNEL as PublishResult["channel"],
        topic: "telemetry.pm",
        dev: "sensor-1",
        txHash: ORIGIN as PublishResult["txHash"],
        status: "published",
        encrypted: true,
        ctxHashes: [CTX_HASH as PublishResult["txHash"]],
        confirmedOffset: 9,
        callbackDeposit: CALLBACK_DEPOSIT,
        ...overrides,
    };
}

export const publishChannelMessage = mock(async () => encryptedPublished());
export const publishDeviceTelemetry = mock(async () => encryptedPublished());
export const publishDeviceCommand = mock(async () =>
    encryptedPublished({ topic: "command.switch.set" }),
);
export const publishAgentOutbound = mock(async () =>
    encryptedPublished({ topic: "decision.log", dev: "controller-1" }),
);
export const publishAgentInbound = mock(async () =>
    encryptedPublished({ topic: "task.assign", dev: "controller" }),
);
export const discloseMessages = mock(async () => ({
    channel: CHANNEL,
    from: 0,
    to: 0,
    messages: [{ offset: 0, rawHex: "0xaa", encrypted: true, topic: "telemetry.pm", p: { n: 1 } }],
    txHash: ORIGIN,
    ctxHashes: [CTX_HASH],
    callbackDeposit: CALLBACK_DEPOSIT,
}));
export const readMessages = mock(async () => ({
    channel: CHANNEL,
    total: 1,
    oldest: 0,
    latest: 0,
    from: 0,
    to: 0,
    messages: [
        {
            offset: 0,
            rawHex: "0xaabbcc",
            encrypted: true,
            ciphertextHex: "0xaabbcc",
            ciphertextBytes: 3,
        },
    ],
}));
export const getWalletInfo = mock(async () => ({
    address: WALLET.address,
    balanceWei: "0",
    balance: "0",
    symbol: "sFUEL",
}));
export const hasPublicKeyWithConfig = mock(async () => false);
export const getViewKeyStatus = mock(async () => ({
    account: WALLET.address,
    registry: "0x00000000000000000000000000000000000000e0",
    registered: false,
    matchesViewKey: false,
    usesSigningKey: true,
    localPublicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
}));
export const getDeviceReaderStatus = mock(async () => ({
    isIncomingReader: false,
    isOutgoingReader: false,
}));
export const getAgentReaderStatus = mock(async () => ({
    isIncomingReader: false,
    isOutgoingReader: false,
}));
export const listDevices = mock(() => []);
export const listAgents = mock(() => []);
export const resolveChannel = mock();
export const resolveAgent = mock();
export const loadAgent = mock();
export const loadConfig = mock(() => CONFIG);
export const loadWallet = mock(() => WALLET);

// Shared across plugin test files: bun's module mocks are process-wide.
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
    MAX_DISCLOSE_BATCH: 10,
    createDefaultConfig: mock(() => CONFIG),
    loadConfig,
    loadWallet,
    loadAgent,
    listDevices,
    listAgents,
    publishChannelMessage,
    publishDeviceCommand,
    publishDeviceTelemetry,
    publishAgentOutbound,
    publishAgentInbound,
    discloseMessages,
    readMessages,
    getWalletInfo,
    hasPublicKeyWithConfig,
    getViewKeyStatus,
    getDeviceReaderStatus,
    getAgentReaderStatus,
    resolveAgent,
    resolveChannel,
}));

export function toolFactory(spec: unknown): unknown {
    return spec;
}

export type ToolSpec = {
    name?: string;
    optional?: boolean;
    execute: (
        params: Record<string, unknown>,
        config: Record<string, unknown>,
        context: { signal?: AbortSignal },
    ) => Promise<unknown>;
};
