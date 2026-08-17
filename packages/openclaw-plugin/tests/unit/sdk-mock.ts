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
export const resolveAgent = mock(async () => ({
    name: "controller-1",
    agentContract: "0x00000000000000000000000000000000000000a1",
    incomingChannel: "0x00000000000000000000000000000000000000c4",
    outgoingChannel: "0x00000000000000000000000000000000000000c5",
    encrypted: true,
}));
export const resolveDevice = mock(async () => ({
    name: "sensor-1",
    deviceContract: "0x00000000000000000000000000000000000000d1",
    incomingChannel: "0x00000000000000000000000000000000000000c2",
    outgoingChannel: "0x00000000000000000000000000000000000000c3",
    encrypted: true,
}));
export const loadAgent = mock();
export const loadConfig = mock(() => CONFIG);
export const loadWallet = mock(() => WALLET);
export const getSetupStatus = mock(async () => ({
    state: "uninitialized",
    ready: false,
    home: { exists: false, configVersion: null, staleConfig: false, fingerprint: "abc" },
    configuration: { persisted: null, pluginOverrides: {}, effective: null, shadowedFields: [] },
    wallet: null,
    attachments: { group: null, agent: null, devices: [] },
    key: null,
    rpc: { ok: true, error: null, url: null },
    issues: [],
}));
export const listGroups = mock(() => []);
export const listPresentedBackups = mock(() => []);
export const discoverGroupsPage = mock(async () => ({
    total: 0,
    offset: 0,
    limit: 50,
    items: [],
    nextOffset: null,
}));
export const discoverDevicesPage = mock(async () => ({
    total: 0,
    offset: 0,
    limit: 50,
    items: [],
    nextOffset: null,
}));
export const discoverAgentsPage = mock(async () => ({
    total: 0,
    offset: 0,
    limit: 50,
    items: [],
    nextOffset: null,
}));
export const listDeviceReaders = mock(async () => []);
export const listAgentReaders = mock(async () => []);
export const initializeHome = mock(() => ({
    walletAddress: WALLET.address,
    network: "base-testnet",
    networkKey: "base-testnet",
    registry: "0x0000000000000000000000000000000000000001",
    chainId: 324705682,
    rpcUrl: "https://example.invalid",
    mode: "controller",
    fingerprint: "init-fp",
    generated: true as const,
}));
export const updateHomeConfig = mock(() => ({
    before: {
        network: "base-testnet",
        chainId: 1,
        rpcUrl: "https://old.invalid",
        registryAddress: "0x0000000000000000000000000000000000000001",
        mode: "controller",
        walletAddress: WALLET.address,
    },
    after: {
        network: "base-testnet",
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545",
        registryAddress: "0x0000000000000000000000000000000000000001",
        mode: "controller",
        walletAddress: WALLET.address,
    },
    fingerprint: "cfg-fp",
}));
export const attachHomeEntities = mock(async () => ({
    group: {
        name: "home",
        groupAddress: "0x0000000000000000000000000000000000000011",
        owner: WALLET.address,
        skills: "",
        deviceCount: 0,
    },
    agent: null,
    devices: [],
    fingerprint: "att-fp",
}));
export const resetHomeChecked = mock(() => ({
    reason: "deployment-change",
    backupName: "backup-20260101-000000Z",
    walletAddress: WALLET.address,
    walletPreserved: true,
    fingerprint: "rst-fp",
}));
export const syncLocalCacheBounded = mock(async () => ({
    groupCount: 1,
    deviceCount: 2,
    agentCount: 0,
    complete: true as const,
}));
export const homeFingerprint = mock(() => "home-fp");
export const resolveGroup = mock(async () => ({
    name: "home",
    groupAddress: "0x0000000000000000000000000000000000000011",
    owner: WALLET.address,
    skills: "",
    deviceCount: 0,
}));
export const registerGroupWithResult = mock(async () => ({
    entity: {
        name: "home",
        groupAddress: "0x0000000000000000000000000000000000000011",
        owner: WALLET.address,
        skills: "",
        deviceCount: 0,
    },
    txHash: ORIGIN,
    receiptStatus: "success" as const,
}));
export const registerDeviceWithResult = mock(async () => ({
    entity: {
        name: "sensor-1",
        deviceContract: "0x00000000000000000000000000000000000000d1",
        groupAddress: "0x0000000000000000000000000000000000000011",
        incomingChannel: "0x00000000000000000000000000000000000000c2",
        outgoingChannel: "0x00000000000000000000000000000000000000c3",
        encrypted: false,
    },
    txHash: ORIGIN,
    receiptStatus: "success" as const,
}));
export const registerAgentWithResult = mock(async () => ({
    entity: {
        name: "controller-1",
        agentContract: "0x00000000000000000000000000000000000000a1",
        owner: WALLET.address,
        incomingChannel: "0x00000000000000000000000000000000000000c4",
        outgoingChannel: "0x00000000000000000000000000000000000000c5",
        encrypted: false,
    },
    txHash: ORIGIN,
    receiptStatus: "success" as const,
}));
export const grantDevicePermission = mock(async () => ({
    device: { name: "sensor-1", deviceContract: "0x00000000000000000000000000000000000000d1" },
    role: "publisher",
    account: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const revokeDevicePermission = mock(async () => ({
    device: { name: "sensor-1", deviceContract: "0x00000000000000000000000000000000000000d1" },
    role: "publisher",
    account: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const grantAgentPermission = mock(async () => ({
    agent: { name: "controller-1", agentContract: "0x00000000000000000000000000000000000000a1" },
    role: "sender",
    account: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const revokeAgentPermission = mock(async () => ({
    agent: { name: "controller-1", agentContract: "0x00000000000000000000000000000000000000a1" },
    role: "sender",
    account: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const grantDeviceReader = mock(async () => ({
    device: "0x00000000000000000000000000000000000000d1",
    side: "outgoing",
    reader: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const revokeDeviceReader = mock(async () => ({
    device: "0x00000000000000000000000000000000000000d1",
    side: "outgoing",
    reader: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const grantAgentReader = mock(async () => ({
    agent: "0x00000000000000000000000000000000000000a1",
    side: "outgoing",
    reader: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const revokeAgentReader = mock(async () => ({
    agent: "0x00000000000000000000000000000000000000a1",
    side: "outgoing",
    reader: "0x00000000000000000000000000000000000000Aa",
    txHash: ORIGIN,
    status: "success" as const,
}));
export const assertNotSelfLockout = mock(
    (params: {
        walletAddress: string;
        account: string;
        role: string;
        allowSelfRevocation?: boolean;
    }) => {
        if (params.walletAddress.toLowerCase() !== params.account.toLowerCase()) return;
        if (params.role !== "master" && params.role !== "agent-admin") return;
        if (params.allowSelfRevocation) return;
        const error = new Error(
            `Refusing to revoke ${params.role} from the active wallet without allowSelfRevocation.`,
        ) as Error & { code: string };
        error.code = "SELF_LOCKOUT_RISK";
        throw error;
    },
);
export const assertNotSelfReaderRevocation = mock(
    (params: { walletAddress: string; account: string; allowSelfRevocation?: boolean }) => {
        if (params.walletAddress.toLowerCase() !== params.account.toLowerCase()) return;
        if (params.allowSelfRevocation) return;
        const error = new Error(
            "Refusing to remove the active wallet's own reader access without allowSelfRevocation.",
        ) as Error & { code: string };
        error.code = "SELF_LOCKOUT_RISK";
        throw error;
    },
);
export const generateViewKeyIfAbsent = mock(() => ({
    fingerprint: "aa".repeat(8),
    registrationRequired: true as const,
    usesSigningKey: false as const,
}));
export const rotateViewKeyChecked = mock(() => ({
    fingerprint: "bb".repeat(8),
    backupName: "backup-20260101-000000Z",
    registrationRequired: true as const,
    abandonedInflightDisclosures: true as const,
}));
export const forgetViewKeyChecked = mock(() => ({
    fingerprint: "cc".repeat(8),
    backupName: "backup-20260101-000000Z",
    registrationRequired: true as const,
    usesSigningKey: true as const,
}));
export const registerActiveViewKey = mock(async () => ({
    registry: "0x00000000000000000000000000000000000000e0",
    account: WALLET.address,
    txHash: ORIGIN,
    status: "success" as const,
    fingerprint: "aa".repeat(8),
    matchesViewKey: true,
    registered: true,
}));
export const removeRegisteredPublicKey = mock(async () => ({
    registry: "0x00000000000000000000000000000000000000e0",
    account: WALLET.address,
    txHash: ORIGIN,
    status: "success" as const,
    fingerprint: "aa".repeat(8),
    matchesViewKey: false,
    registered: false,
}));

// Shared across plugin test files: bun's module mocks are process-wide.
mock.module("@smartclaws/sdk", () => {
    class SmartClawsError extends Error {
        code: string;
        details?: Record<string, unknown>;

        constructor(code: string, message: string, details?: Record<string, unknown>) {
            super(message);
            this.name = "SmartClawsError";
            this.code = code;
            this.details = details;
        }
    }
    return {
        SmartClawsError,
        localSaveFailed: (txHash: string, publicData: Record<string, unknown>, cause: unknown) =>
            new SmartClawsError(
                "LOCAL_STATE_SAVE_FAILED",
                "On-chain registration confirmed, but local state could not be saved. Do not retry registration; attach the confirmed entity instead.",
                {
                    txHash,
                    ...publicData,
                    cause: cause instanceof Error ? cause.message : String(cause),
                },
            ),
        MAX_DISCLOSE_BATCH: 10,
        createDefaultConfig: mock(() => CONFIG),
        loadConfig,
        loadWallet,
        loadAgent,
        listDevices,
        listAgents,
        listGroups,
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
        getSetupStatus,
        listPresentedBackups,
        discoverGroupsPage,
        discoverDevicesPage,
        discoverAgentsPage,
        listDeviceReaders,
        listAgentReaders,
        initializeHome,
        updateHomeConfig,
        attachHomeEntities,
        resetHomeChecked,
        syncLocalCacheBounded,
        homeFingerprint,
        resolveGroup,
        registerGroupWithResult,
        registerDeviceWithResult,
        registerAgentWithResult,
        grantDevicePermission,
        revokeDevicePermission,
        grantAgentPermission,
        revokeAgentPermission,
        grantDeviceReader,
        revokeDeviceReader,
        grantAgentReader,
        revokeAgentReader,
        assertNotSelfLockout,
        assertNotSelfReaderRevocation,
        generateViewKeyIfAbsent,
        rotateViewKeyChecked,
        forgetViewKeyChecked,
        registerActiveViewKey,
        removeRegisteredPublicKey,
        resolveAgent,
        resolveDevice,
        resolveChannel,
    };
});

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
