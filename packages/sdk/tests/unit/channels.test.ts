import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import SmartClawsChannelEncryptedABI from "@smartclaws/core/abi/SmartClawsChannelEncrypted.json" with {
    type: "json",
};
import { encode } from "@smartclaws/core/envelope";
import type { Config, WalletFile } from "@smartclaws/core/types";
import {
    type Abi,
    type Address,
    decodeAbiParameters,
    encodeAbiParameters,
    encodeEventTopics,
    getAddress,
    type Hex,
    toHex,
} from "viem";
import * as contracts from "../../src/contracts.js";
import { SmartClawsError } from "../../src/errors.js";
import {
    discloseMessages,
    MAX_DISCLOSE_BATCH,
    publishAgentInbound,
    publishAgentOutbound,
    publishChannelMessage,
    publishDeviceCommand,
    publishDeviceTelemetry,
    readMessages,
} from "../../src/services/channels.js";
import * as ctx from "../../src/services/ctx.js";
import type { EncryptionProvider } from "../../src/services/encryption.js";
import * as keys from "../../src/services/keys.js";
import { InvalidDecryptedEnvelopeError } from "../../src/services/keys.js";
import * as readers from "../../src/services/readers.js";

const CONFIG: Config = {
    version: 3,
    network: "base-testnet",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:0",
    contractAddress: "0x0000000000000000000000000000000000000001",
    walletAddress: "0x0000000000000000000000000000000000000002",
    mode: "controller",
    deviceGroupAddress: "",
    attachedGroupAddress: "",
    attachedAgentAddress: "",
    attachedDeviceAddresses: [],
};

const WALLET: WalletFile = {
    address: "0x0000000000000000000000000000000000000002",
    privateKey: `0x${"11".repeat(32)}`,
};

const VIEW_WALLET: WalletFile = {
    ...WALLET,
    viewPrivateKey: `0x${"22".repeat(32)}`,
};

const CHANNEL = getAddress("0x00000000000000000000000000000000000000c1");
const DEVICE = getAddress("0x00000000000000000000000000000000000000d1");
const AGENT = getAddress("0x00000000000000000000000000000000000000a1");
const ORIGIN = `0x${"01".repeat(32)}` as Hex;
const CTX_HASH = `0x${"ab".repeat(32)}` as Hex;
const ABI = SmartClawsChannelEncryptedABI.abi as Abi;
const GAS_PRICE = Object(7n) as unknown as bigint;
const INVALID_ENVELOPE_FIXTURE =
    "0x000102030405060708090a0b0c0d0e0f02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f2703d5bf90be4e1c70307b6682c801090f" as Hex;

class FakeEncryptionProvider implements EncryptionProvider {
    calls: Array<{ message: Hex; ctxSubmitterAddress: Address }> = [];
    ciphertext: Hex = "0xaabbcc";

    async encryptMessageForCTX(message: Hex, ctxSubmitterAddress: Address): Promise<Hex> {
        this.calls.push({ message, ctxSubmitterAddress });
        return this.ciphertext;
    }
}

function publishedLog(channel: Address, offset: bigint) {
    return {
        address: channel,
        topics: encodeEventTopics({
            abi: ABI,
            eventName: "MessagePublished",
            args: { channel, offset },
        }),
        data: "0x" as Hex,
    };
}

function disclosedLog(channel: Address, reader: Address, offset: bigint, payload: Hex) {
    return {
        address: channel,
        topics: encodeEventTopics({
            abi: ABI,
            eventName: "MessageDisclosed",
            args: { channel, reader, offset },
        }),
        data: encodeAbiParameters([{ type: "bytes" }], [payload]),
    };
}

function mockPublicClient(
    receipt: { status: "success" | "reverted"; logs?: unknown[] } = {
        status: "success",
        logs: [],
    },
) {
    const publicClient = {
        getGasPrice: async () => GAS_PRICE,
        waitForTransactionReceipt: async () => receipt,
    };
    spyOn(contracts, "getClients").mockReturnValue({
        publicClient,
        walletClient: {},
        account: { address: WALLET.address },
    } as never);
    spyOn(contracts, "getPublicClient").mockReturnValue(publicClient as never);
    return publicClient;
}

function mockEncryptedFeeContract(callbackGas = 152_400n) {
    spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
        read: {
            getPublishCallbackGas: async () => callbackGas,
            getReadCallbackGas: async () => callbackGas,
            getMessageCount: async () => 1n,
            getOldestMessageOffset: async () => 0n,
            getLatestMessageOffset: async () => 0n,
            readMessages: async () => [["0xaabbcc"], [0n]],
        },
    } as never);
}

afterEach(() => {
    mock.restore();
    contracts.clearContractCaches();
});

describe("readMessages", () => {
    test("returns labelled ciphertext on an encrypted channel without decodeError", async () => {
        const ciphertext = "0xdeadbeef" as Hex;
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelReadContract").mockReturnValue({
            read: {
                getMessageCount: async () => 1n,
                getOldestMessageOffset: async () => 0n,
                getLatestMessageOffset: async () => 0n,
                readMessages: async () => [[ciphertext], [0n]],
            },
        } as never);
        const getClients = spyOn(contracts, "getClients");

        const result = await readMessages({ channelAddress: CHANNEL }, CONFIG);

        expect(getClients).not.toHaveBeenCalled();
        expect(result.messages).toEqual([
            {
                offset: 0,
                rawHex: ciphertext,
                encrypted: true,
                ciphertextHex: ciphertext,
                ciphertextBytes: 4,
            },
        ]);
        expect(result.messages[0]?.decodeError).toBeUndefined();
        expect(result.messages[0]?.ciphertextBytes).not.toBe(ciphertext.length);
    });

    test("still decodes envelopes on a plain channel", async () => {
        const envelope = encode("telemetry.temp", { c: 21 }, "sensor");
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        spyOn(contracts, "getChannelReadContract").mockReturnValue({
            read: {
                getMessageCount: async () => 1n,
                getOldestMessageOffset: async () => 0n,
                getLatestMessageOffset: async () => 0n,
                readMessages: async () => [[toHex(envelope)], [0n]],
            },
        } as never);

        const result = await readMessages({ channelAddress: CHANNEL }, CONFIG);
        expect(result.messages[0]?.encrypted).toBeUndefined();
        expect(result.messages[0]?.decodeError).toBeUndefined();
        expect(result.messages[0]?.topic).toBe("telemetry.temp");
        expect(result.messages[0]?.p).toEqual({ c: 21 });
    });

    test("labels plain garbage as decodeError, not encrypted ciphertext", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        spyOn(contracts, "getChannelReadContract").mockReturnValue({
            read: {
                getMessageCount: async () => 1n,
                getOldestMessageOffset: async () => 0n,
                getLatestMessageOffset: async () => 0n,
                readMessages: async () => [["0xffff"], [3n]],
            },
        } as never);

        const result = await readMessages({ channelAddress: CHANNEL }, CONFIG);
        expect(result.messages[0]).toEqual({ offset: 3, rawHex: "0xffff", decodeError: true });
    });
});

describe("plain publish", () => {
    test("sends exactly zero value and reports published from MessagePublished", async () => {
        const writes: Array<{ data: Hex; tx: unknown }> = [];
        mockPublicClient({
            status: "success",
            logs: [publishedLog(CHANNEL, 4n)],
        });
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: {
                publishMessage: async ([data]: [Hex], tx: unknown) => {
                    writes.push({ data, tx });
                    return ORIGIN;
                },
            },
        } as never);

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: { a: 1 }, from: "dev" },
            CONFIG,
            WALLET,
        );

        expect(writes[0]?.tx).toEqual({ value: 0n });
        expect(result.status).toBe("published");
        expect(result.encrypted).toBe(false);
        expect(result.confirmedOffset).toBe(4);
        expect(result.callbackDeposit).toBeUndefined();
    });

    test.each([
        [
            "publishChannelMessage",
            async (write: (data: Hex, tx: unknown) => Promise<Hex>) => {
                spyOn(contracts, "getChannelContract").mockReturnValue({
                    write: { publishMessage: write },
                } as never);
                return publishChannelMessage(
                    { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
                    CONFIG,
                    WALLET,
                );
            },
        ],
        [
            "publishDeviceTelemetry",
            async (write: (data: Hex, tx: unknown) => Promise<Hex>) => {
                spyOn(contracts, "getDeviceWriteContract").mockReturnValue({
                    read: { getOutgoingMessagesChannel: async () => CHANNEL },
                    write: { publishTelemetry: write },
                } as never);
                return publishDeviceTelemetry(
                    { deviceAddress: DEVICE, topic: "t", payload: {}, from: "d" },
                    CONFIG,
                    WALLET,
                );
            },
        ],
        [
            "publishDeviceCommand",
            async (write: (data: Hex, tx: unknown) => Promise<Hex>) => {
                spyOn(contracts, "getDeviceWriteContract").mockReturnValue({
                    read: { getIncomingMessagesChannel: async () => CHANNEL },
                    write: { publishCommand: write },
                } as never);
                return publishDeviceCommand(
                    { deviceAddress: DEVICE, topic: "t", payload: {}, from: "d" },
                    CONFIG,
                    WALLET,
                );
            },
        ],
        [
            "publishAgentOutbound",
            async (write: (data: Hex, tx: unknown) => Promise<Hex>) => {
                spyOn(contracts, "getAgentWriteContract").mockReturnValue({
                    read: { getOutgoingMessagesChannel: async () => CHANNEL },
                    write: { publishOutbound: write },
                } as never);
                return publishAgentOutbound(
                    { agentAddress: AGENT, topic: "t", payload: {}, from: "d" },
                    CONFIG,
                    WALLET,
                );
            },
        ],
        [
            "publishAgentInbound",
            async (write: (data: Hex, tx: unknown) => Promise<Hex>) => {
                spyOn(contracts, "getAgentWriteContract").mockReturnValue({
                    read: { getIncomingMessagesChannel: async () => CHANNEL },
                    write: { publishInbound: write },
                } as never);
                return publishAgentInbound(
                    { agentAddress: AGENT, topic: "t", payload: {}, from: "d" },
                    CONFIG,
                    WALLET,
                );
            },
        ],
    ] as const)("%s sends exactly zero value on a plain channel", async (_name, run) => {
        const sent: unknown[] = [];
        mockPublicClient({ status: "success", logs: [publishedLog(CHANNEL, 0n)] });
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        await run(async (_data, tx) => {
            sent.push(tx);
            return ORIGIN;
        });
        expect(sent).toEqual([{ value: 0n }]);
    });
});

describe("encrypted publish", () => {
    test("frames the wallet (not the device) and binds AAD to the channel", async () => {
        const provider = new FakeEncryptionProvider();
        const writes: Array<{ data: Hex; tx: { value: bigint; gasPrice: bigint } }> = [];
        mockPublicClient({ status: "success", logs: [] });
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getDeviceWriteContract").mockReturnValue({
            read: { getOutgoingMessagesChannel: async () => CHANNEL },
            write: {
                publishTelemetry: async (
                    [data]: [Hex],
                    tx: { value: bigint; gasPrice: bigint },
                ) => {
                    writes.push({ data, tx });
                    return ORIGIN;
                },
            },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockResolvedValue({
            originHash: ORIGIN,
            originReceipt: { status: "success" },
            ctxHashes: [CTX_HASH],
            ctxReceipts: [{ status: "success", logs: [publishedLog(CHANNEL, 9n)] }],
        } as never);

        const result = await publishDeviceTelemetry(
            { deviceAddress: DEVICE, topic: "t", payload: { n: 1 }, from: "sensor" },
            CONFIG,
            WALLET,
            { encryption: provider },
        );

        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]?.ctxSubmitterAddress).toBe(CHANNEL);
        expect(provider.calls[0]?.ctxSubmitterAddress).not.toBe(DEVICE);
        const [publisher] = decodeAbiParameters(
            [{ type: "address" }, { type: "bytes" }],
            provider.calls[0]?.message as Hex,
        );
        expect(getAddress(publisher)).toBe(getAddress(WALLET.address));
        expect(getAddress(publisher)).not.toBe(DEVICE);
        expect(writes[0]?.data).toBe("0xaabbcc");
        expect(writes[0]?.tx.gasPrice).toBe(GAS_PRICE);
        expect(writes[0]?.tx.value).toBe(152_400n * 7n);
        expect(result.status).toBe("published");
        expect(result.confirmedOffset).toBe(9);
        expect(result.callbackDeposit).toBe(152_400n * 7n);
        expect(result.ctxHashes).toEqual([CTX_HASH]);
    });

    test("origin success without waiting is scheduled, never published", async () => {
        const wait = spyOn(ctx, "waitForCtxReceipts");
        mockPublicClient({ status: "success", logs: [publishedLog(CHANNEL, 1n)] });
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
            CONFIG,
            WALLET,
            { wait: false, encryption: new FakeEncryptionProvider() },
        );

        expect(result.status).toBe("scheduled");
        expect(result.confirmedOffset).toBeUndefined();
        expect(wait).not.toHaveBeenCalled();
    });

    test("CTX_NOT_FOUND stays scheduled so callers re-check instead of resubmitting", async () => {
        mockPublicClient();
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockRejectedValue(
            new SmartClawsError("CTX_NOT_FOUND", "No CTX has been crafted yet", {
                originHash: ORIGIN,
            }),
        );

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
            CONFIG,
            WALLET,
            { encryption: new FakeEncryptionProvider() },
        );

        expect(result.status).toBe("scheduled");
        expect(result.txHash).toBe(ORIGIN);
        expect(result.callbackDeposit).toBe(152_400n * 7n);
    });

    test("ORIGIN_REVERTED maps to origin-reverted and is safe to resubmit", async () => {
        mockPublicClient();
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockRejectedValue(
            new SmartClawsError("ORIGIN_REVERTED", "Origin transaction reverted"),
        );

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
            CONFIG,
            WALLET,
            { encryption: new FakeEncryptionProvider() },
        );

        expect(result.status).toBe("origin-reverted");
        expect(result.callbackDeposit).toBeUndefined();
    });

    test("CTX_FAILED maps to ctx-reverted", async () => {
        mockPublicClient();
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockRejectedValue(
            new SmartClawsError("CTX_FAILED", "CTX transaction reverted"),
        );

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
            CONFIG,
            WALLET,
            { encryption: new FakeEncryptionProvider() },
        );

        expect(result.status).toBe("ctx-reverted");
        expect(result.callbackDeposit).toBe(152_400n * 7n);
    });

    test("successful CTX without MessagePublished is ctx-reverted, not published", async () => {
        mockPublicClient();
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockResolvedValue({
            originHash: ORIGIN,
            originReceipt: { status: "success" },
            ctxHashes: [CTX_HASH],
            ctxReceipts: [{ status: "success", logs: [] }],
        } as never);

        const result = await publishChannelMessage(
            { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
            CONFIG,
            WALLET,
            { encryption: new FakeEncryptionProvider() },
        );

        expect(result.status).toBe("ctx-reverted");
        expect(result.confirmedOffset).toBeUndefined();
    });

    test("CTX_MALFORMED_RESPONSE is surfaced, not rewritten as a publish state", async () => {
        mockPublicClient();
        mockEncryptedFeeContract();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(contracts, "getChannelContract").mockReturnValue({
            write: { publishMessage: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockRejectedValue(
            new SmartClawsError("CTX_MALFORMED_RESPONSE", "CTX hash must contain exactly 32 bytes"),
        );

        try {
            await publishChannelMessage(
                { channelAddress: CHANNEL, topic: "t", payload: {}, from: "d" },
                CONFIG,
                WALLET,
                { encryption: new FakeEncryptionProvider() },
            );
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(SmartClawsError);
            expect((error as SmartClawsError).code).toBe("CTX_MALFORMED_RESPONSE");
        }
    });
});

describe("discloseMessages", () => {
    test("rejects a plain channel before spending", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(false);
        const write = spyOn(contracts, "getEncryptedChannelContract");
        try {
            await discloseMessages(
                { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
                CONFIG,
                VIEW_WALLET,
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("ENCRYPTION_UNSUPPORTED");
        }
        expect(write).not.toHaveBeenCalled();
    });

    test("rejects batches outside 1–10 and never splits them", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        const write = spyOn(contracts, "getEncryptedChannelContract");
        for (const count of [0, 11, MAX_DISCLOSE_BATCH + 1, 1.5]) {
            try {
                await discloseMessages(
                    { channelAddress: CHANNEL, fromOffset: 0, count },
                    CONFIG,
                    WALLET,
                );
                throw new Error(`expected throw for count=${count}`);
            } catch (error) {
                expect((error as SmartClawsError).code).toBe("READ_BATCH_LIMIT");
            }
        }
        expect(write).not.toHaveBeenCalled();
    });

    test("fails with NO_VIEW_KEY before sending a transaction", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        const write = spyOn(contracts, "getEncryptedChannelContract");
        try {
            await discloseMessages(
                { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
                CONFIG,
                WALLET,
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("NO_VIEW_KEY");
        }
        expect(write).not.toHaveBeenCalled();
    });

    test("fails with NOT_A_READER before sending a transaction", async () => {
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(readers, "isAuthorizedReader").mockResolvedValue(false);
        const write = spyOn(contracts, "getEncryptedChannelContract");
        try {
            await discloseMessages(
                { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
                CONFIG,
                VIEW_WALLET,
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("NOT_A_READER");
        }
        expect(write).not.toHaveBeenCalled();
    });

    test("fails with NO_PUBLIC_KEY before sending a transaction", async () => {
        mockPublicClient();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(readers, "isAuthorizedReader").mockResolvedValue(true);
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(
            "0x00000000000000000000000000000000000000b4" as Address,
        );
        spyOn(keys, "hasPublicKey").mockResolvedValue(false);
        const write = spyOn(contracts, "getEncryptedChannelContract");
        try {
            await discloseMessages(
                { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
                CONFIG,
                VIEW_WALLET,
            );
            throw new Error("expected throw");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("NO_PUBLIC_KEY");
        }
        expect(write).not.toHaveBeenCalled();
    });

    test("quotes gas once and sends that exact gas price with the callback deposit", async () => {
        const writes: Array<{ args: unknown; tx: { value: bigint; gasPrice: bigint } }> = [];
        mockPublicClient();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(readers, "isAuthorizedReader").mockResolvedValue(true);
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(
            "0x00000000000000000000000000000000000000b4" as Address,
        );
        spyOn(keys, "hasPublicKey").mockResolvedValue(true);
        spyOn(keys, "decryptDisclosedEnvelope").mockReturnValue({
            v: 1 as const,
            ts: 1,
            dev: "sensor",
            topic: "t",
            p: {},
        });
        spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
            read: {
                getMessageCount: async () => 1n,
                getOldestMessageOffset: async () => 0n,
                getLatestMessageOffset: async () => 0n,
                readMessages: async () => [["0xaabbcc"], [0n]],
                getReadCallbackGas: async (args: [bigint, bigint]) => {
                    expect(args[0]).toBe(3n);
                    expect(args[1]).toBe(1n);
                    return 200_000n;
                },
            },
        } as never);
        spyOn(contracts, "getEncryptedChannelContract").mockReturnValue({
            write: {
                requestMessages: async (args: unknown, tx: { value: bigint; gasPrice: bigint }) => {
                    writes.push({ args, tx });
                    return ORIGIN;
                },
            },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockResolvedValue({
            originHash: ORIGIN,
            originReceipt: { status: "success" },
            ctxHashes: [CTX_HASH],
            ctxReceipts: [
                {
                    status: "success",
                    logs: [disclosedLog(CHANNEL, getAddress(WALLET.address), 0n, "0xaabbcc")],
                },
            ],
        } as never);

        const result = await discloseMessages(
            { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
            CONFIG,
            VIEW_WALLET,
        );

        expect(writes[0]?.tx.gasPrice).toBe(GAS_PRICE);
        expect(writes[0]?.tx.value).toBe(200_000n * 7n);
        expect(result.callbackDeposit).toBe(200_000n * 7n);
        expect(result.messages[0]?.topic).toBe("t");
        expect(result.messages[0]?.decodeError).toBeUndefined();
    });

    test("garbage ECIES plaintext surfaces InvalidDecryptedEnvelopeError, not decodeError", async () => {
        mockPublicClient();
        spyOn(contracts, "resolveChannelEncrypted").mockResolvedValue(true);
        spyOn(readers, "isAuthorizedReader").mockResolvedValue(true);
        spyOn(contracts, "resolvePublicKeyRegistryAddress").mockResolvedValue(
            "0x00000000000000000000000000000000000000b4" as Address,
        );
        spyOn(keys, "hasPublicKey").mockResolvedValue(true);
        spyOn(contracts, "getEncryptedChannelReadContract").mockReturnValue({
            read: {
                getMessageCount: async () => 1n,
                getOldestMessageOffset: async () => 0n,
                getLatestMessageOffset: async () => 0n,
                readMessages: async () => [[INVALID_ENVELOPE_FIXTURE], [0n]],
                getReadCallbackGas: async () => 200_000n,
            },
        } as never);
        spyOn(contracts, "getEncryptedChannelContract").mockReturnValue({
            write: { requestMessages: async () => ORIGIN },
        } as never);
        spyOn(ctx, "waitForCtxReceipts").mockResolvedValue({
            originHash: ORIGIN,
            originReceipt: { status: "success" },
            ctxHashes: [CTX_HASH],
            ctxReceipts: [
                {
                    status: "success",
                    logs: [
                        disclosedLog(
                            CHANNEL,
                            getAddress(WALLET.address),
                            0n,
                            INVALID_ENVELOPE_FIXTURE,
                        ),
                    ],
                },
            ],
        } as never);

        try {
            await discloseMessages(
                { channelAddress: CHANNEL, fromOffset: 0, count: 1 },
                CONFIG,
                { ...WALLET, viewPrivateKey: WALLET.privateKey },
            );
            throw new Error("expected throw");
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidDecryptedEnvelopeError);
            expect(error).not.toBeInstanceOf(SmartClawsError);
        }
    });
});
