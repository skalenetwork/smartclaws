import SmartClawsChannelEncryptedABI from "@smartclaws/core/abi/SmartClawsChannelEncrypted.json" with {
    type: "json",
};
import { decode, encode } from "@smartclaws/core/envelope";
import type { Config, WalletFile } from "@smartclaws/core/types";
import { type Abi, type Address, getAddress, type Hex, parseEventLogs, toBytes, toHex } from "viem";
import { loadAgent } from "../agent.js";
import * as contracts from "../contracts.js";
import { loadDevice } from "../device.js";
import { SmartClawsError } from "../errors.js";
import * as ctx from "./ctx.js";
import { resolveDevice } from "./discovery.js";
import {
    BiteEncryptionProvider,
    ciphertextByteLength,
    type EncryptionProvider,
    encryptForChannel,
    quotePublishFee,
    quoteReadFee,
} from "./encryption.js";
import * as keys from "./keys.js";
import * as readers from "./readers.js";

/** Contract `MAX_READ_BATCH`. Disclosure never silently splits a larger range into several paid txs. */
export const MAX_DISCLOSE_BATCH = 10;

export type PublishState = "published" | "scheduled" | "origin-reverted" | "ctx-reverted";

/**
 * Map the encrypted-publish error codes onto PublishState. CTX_MALFORMED_RESPONSE is
 * intentionally absent: the node's reply was unparseable, which is not a publish outcome
 * and must not be treated as a reason to resubmit or to stop waiting.
 *
 * CTX_NOT_FOUND maps to `scheduled`, not a failure. A CTX that has not appeared yet may
 * still land; treating that wait timeout as failure is how callers double-pay.
 */
export function publishStateFromError(error: unknown): PublishState | undefined {
    if (!(error instanceof SmartClawsError)) return undefined;
    switch (error.code) {
        case "ORIGIN_REVERTED":
            return "origin-reverted";
        case "CTX_NOT_FOUND":
            return "scheduled";
        case "CTX_FAILED":
            return "ctx-reverted";
        default:
            return undefined;
    }
}

/**
 * Which half of an entity's channel pair. Devices and agents each own two channels,
 * and both are readable: `outgoing` is the entity speaking (telemetry, decision logs),
 * `incoming` is what was sent to it (commands, notifications).
 */
export type ChannelSide = "incoming" | "outgoing";

export interface ChannelTarget {
    /** Local device name, id or address. */
    device?: string;
    /** Local agent name, id or address. */
    agent?: string;
    /** Direct channel address. Mutually exclusive with `device` and `agent`. */
    channel?: string;
    /**
     * Which side of the entity's pair to resolve. Defaults to `outgoing`, which is the
     * common case. Rejected alongside `channel`, where an address already names one
     * specific channel and a side could only be silently ignored.
     */
    side?: ChannelSide;
}

export interface ResolvedChannel {
    channelAddress: Address;
    /** The side actually resolved. Always `outgoing` for a direct channel address. */
    side: ChannelSide;
    device?: string;
    deviceAddress?: Address;
    agent?: string;
    agentAddress?: Address;
}

/**
 * Resolve a `{ device }`, `{ agent }` or `{ channel }` target to a channel address.
 *
 * Local and synchronous by design: it reads the on-disk records only, never the chain,
 * so free walletless reads stay free. A name absent from the local cache is an error
 * rather than a chain lookup.
 *
 * Throws `INVALID_TARGET` unless exactly one target is given, and
 * `DEVICE_NOT_FOUND` / `ENTITY_NOT_FOUND` when the named entity has no local record.
 */
export function resolveChannel(target: ChannelTarget, homeDir?: string): ResolvedChannel {
    const targets = [target.device, target.agent, target.channel].filter(Boolean);
    if (targets.length !== 1) {
        throw new SmartClawsError(
            "INVALID_TARGET",
            "Provide exactly one of `device`, `agent` or `channel`.",
            { device: target.device, agent: target.agent, channel: target.channel },
        );
    }

    const side: ChannelSide = target.side ?? "outgoing";

    if (target.channel) {
        if (target.side) {
            throw new SmartClawsError(
                "INVALID_TARGET",
                "`side` applies to `device` and `agent` targets; a channel address already names one channel.",
                { channel: target.channel, side: target.side },
            );
        }
        return { channelAddress: target.channel as Address, side: "outgoing" };
    }

    if (target.agent) {
        const agent = loadAgent(target.agent, homeDir);
        if (!agent) {
            throw new SmartClawsError("ENTITY_NOT_FOUND", `Agent '${target.agent}' not found.`, {
                agent: target.agent,
            });
        }
        return {
            channelAddress: (side === "incoming"
                ? agent.incomingChannel
                : agent.outgoingChannel) as Address,
            side,
            agent: agent.name,
            agentAddress: agent.agentContract as Address,
        };
    }

    const device = loadDevice(target.device as string, homeDir);
    if (!device) {
        throw new SmartClawsError("DEVICE_NOT_FOUND", `Device '${target.device}' not found.`, {
            device: target.device,
        });
    }
    if (!device.incomingChannel || !device.outgoingChannel) {
        throw new SmartClawsError(
            "ENTITY_NOT_HYDRATED",
            `Device '${target.device}' is cached as a summary and has no channel data yet.`,
            { device: target.device, address: device.deviceContract },
        );
    }
    return {
        channelAddress: (side === "incoming"
            ? device.incomingChannel
            : device.outgoingChannel) as Address,
        side,
        device: device.name,
        deviceAddress: device.deviceContract as Address,
    };
}

/** Resolve a channel, hydrating a summary-only device record on first operational use. */
export async function resolveChannelWithConfig(
    target: ChannelTarget,
    config: Config,
    wallet?: WalletFile,
    homeDir?: string,
): Promise<ResolvedChannel> {
    if (!target.device) return resolveChannel(target, homeDir);
    const targets = [target.device, target.agent, target.channel].filter(Boolean);
    if (targets.length !== 1) return resolveChannel(target, homeDir);
    const device = await resolveDevice(target.device, config, wallet, homeDir);
    const side: ChannelSide = target.side ?? "outgoing";
    return {
        channelAddress: (side === "incoming"
            ? device.incomingChannel
            : device.outgoingChannel) as Address,
        side,
        device: device.name,
        deviceAddress: device.deviceContract as Address,
    };
}

export interface ReadMessage {
    offset: number;
    /** Raw on-chain payload as hex; always present. */
    rawHex: `0x${string}`;
    /** True when a plain-channel payload could not be decoded as a SmartClaws envelope. */
    decodeError?: boolean;
    /** Present on encrypted-channel ciphertext reads. Ciphertext is a successful read. */
    encrypted?: boolean;
    ciphertextHex?: `0x${string}`;
    ciphertextBytes?: number;
    v?: number;
    ts?: number;
    dev?: string;
    topic?: string;
    p?: Record<string, unknown>;
}

export interface ReadResult {
    channel: Address;
    total: number;
    oldest: number;
    latest: number;
    from: number;
    to: number;
    encrypted: boolean;
    messages: ReadMessage[];
}

export interface ReadParams {
    channelAddress: Address;
    limit?: number;
    offset?: number;
}

/**
 * Read messages from a channel. Read-only: uses a public client, no wallet/signing.
 * Encrypted channels return labelled ciphertext (`encrypted`, `ciphertextHex`,
 * `ciphertextBytes`) and never report `decodeError` — reading ciphertext is success.
 * Disclosure is a separate, paid operation.
 */
export async function readMessages(params: ReadParams, config: Config): Promise<ReadResult> {
    const { channelAddress } = params;

    if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) {
        throw new SmartClawsError("INVALID_RANGE", "`limit` must be a positive integer.", {
            limit: params.limit,
        });
    }
    if (
        params.offset !== undefined &&
        (!Number.isSafeInteger(params.offset) || params.offset < 0)
    ) {
        throw new SmartClawsError("INVALID_RANGE", "`offset` must be a non-negative integer.", {
            offset: params.offset,
        });
    }
    const limitReq = BigInt(params.limit ?? 10);

    const channel = contracts.getChannelReadContract(channelAddress, config);
    const encrypted = await contracts.resolveChannelEncrypted(channelAddress, config);

    const count = (await channel.read.getMessageCount()) as bigint;
    if (count === 0n) {
        return {
            channel: channelAddress,
            total: 0,
            oldest: 0,
            latest: 0,
            from: 0,
            to: 0,
            encrypted,
            messages: [],
        };
    }

    const oldest = (await channel.read.getOldestMessageOffset()) as bigint;
    const latest = (await channel.read.getLatestMessageOffset()) as bigint;

    if (params.offset !== undefined) {
        const off = BigInt(params.offset);
        if (off < oldest || off > latest) {
            throw new SmartClawsError(
                "INVALID_RANGE",
                `\`offset\` ${params.offset} is out of range; available offsets are ${oldest}..${latest}.`,
                { offset: params.offset, oldest: Number(oldest), latest: Number(latest) },
            );
        }
    }

    const available = latest - oldest + 1n;
    const limit = limitReq > available ? available : limitReq;
    const from =
        params.offset !== undefined
            ? BigInt(params.offset)
            : latest - limit + 1n < oldest
              ? oldest
              : latest - limit + 1n;
    const readCount = from + limit > latest + 1n ? latest + 1n - from : limit;

    const [payloads, offsets] = (await channel.read.readMessages([from, readCount])) as [
        readonly `0x${string}`[],
        readonly bigint[],
    ];

    const messages: ReadMessage[] = payloads.map((p, i) => {
        const offset = Number(offsets[i]);
        if (encrypted) {
            return {
                offset,
                rawHex: p,
                encrypted: true,
                ciphertextHex: p,
                ciphertextBytes: ciphertextByteLength(p),
            };
        }
        try {
            const env = decode(toBytes(p));
            return { offset, rawHex: p, ...env };
        } catch {
            return { offset, rawHex: p, decodeError: true };
        }
    });

    return {
        channel: channelAddress,
        total: Number(count),
        oldest: Number(oldest),
        latest: Number(latest),
        from: Number(from),
        to: Number(from + readCount - 1n),
        encrypted,
        messages,
    };
}

export interface PublishParams {
    channelAddress: Address;
    topic: string;
    payload: Record<string, unknown>;
    /** Envelope `dev` field — the publishing identity. */
    from: string;
}

export interface PublishOptions {
    /**
     * Wait for CTX confirmation on encrypted publishes. Default true.
     * When false (`--no-wait` style), a mined origin tx is `scheduled`, never `published`.
     */
    wait?: boolean;
    encryption?: EncryptionProvider;
    ctxRetry?: ctx.CtxRetryOptions;
}

export interface PublishResult {
    channel: Address;
    topic: string;
    dev: string;
    txHash: `0x${string}`;
    /** Truthful publication outcome. Replaces the old origin-only `success`/`reverted`. */
    status: PublishState;
    encrypted: boolean;
    ctxHashes?: Hex[];
    confirmedOffset?: number;
    /**
     * Native value sent to fund the BITE callback. This is a callback deposit, not the
     * final cost: refunds are asynchronous and a failed callback can strand value.
     */
    callbackDeposit?: bigint;
}

export interface DevicePublishParams {
    deviceAddress: Address;
    topic: string;
    payload: Record<string, unknown>;
    /** Envelope `dev` field — usually the device id/name. */
    from: string;
}

export interface AgentPublishParams {
    agentAddress: Address;
    topic: string;
    payload: Record<string, unknown>;
    /** Envelope `dev` field — usually the agent id/name (or the sender's id). */
    from: string;
}

/**
 * Encode and publish an envelope to a channel. Requires a wallet (signs the
 * transaction). Encrypted channels are `published` only after the CTX receipt
 * carries `MessagePublished`; origin success alone is `scheduled`.
 */
export async function publishChannelMessage(
    params: PublishParams,
    config: Config,
    wallet: WalletFile,
    options?: PublishOptions,
): Promise<PublishResult> {
    const { channelAddress, topic, payload, from } = params;
    const channel = contracts.getChannelContract(channelAddress, config, wallet);
    return submitPublication({
        channelAddress,
        topic,
        from,
        envelope: encode(topic, payload, from),
        config,
        wallet,
        options,
        write: (data, tx) => channel.write.publishMessage([data], tx) as Promise<Hex>,
    });
}

/**
 * Publish telemetry through SmartClawsDevice.publishTelemetry so the device
 * contract enforces PUBLISHER_ROLE and channel ownership correctly.
 */
export async function publishDeviceTelemetry(
    params: DevicePublishParams,
    config: Config,
    wallet: WalletFile,
    options?: PublishOptions,
): Promise<PublishResult> {
    const { deviceAddress, topic, payload, from } = params;
    const device = contracts.getDeviceWriteContract(deviceAddress, config, wallet);
    const channelAddress = getAddress((await device.read.getOutgoingMessagesChannel()) as Address);
    return submitPublication({
        channelAddress,
        topic,
        from,
        envelope: encode(topic, payload, from),
        config,
        wallet,
        options,
        write: (data, tx) => device.write.publishTelemetry([data], tx) as Promise<Hex>,
    });
}

/**
 * Publish a command through SmartClawsDevice.publishCommand so the device
 * contract enforces MASTER_ROLE and channel ownership correctly.
 */
export async function publishDeviceCommand(
    params: DevicePublishParams,
    config: Config,
    wallet: WalletFile,
    options?: PublishOptions,
): Promise<PublishResult> {
    const { deviceAddress, topic, payload, from } = params;
    const device = contracts.getDeviceWriteContract(deviceAddress, config, wallet);
    const channelAddress = getAddress((await device.read.getIncomingMessagesChannel()) as Address);
    return submitPublication({
        channelAddress,
        topic,
        from,
        envelope: encode(topic, payload, from),
        config,
        wallet,
        options,
        write: (data, tx) => device.write.publishCommand([data], tx) as Promise<Hex>,
    });
}

/**
 * Publish an agent-authored message through SmartClawsAgent.publishOutbound so
 * the agent contract enforces PUBLISHER_ROLE and channel ownership. This is the
 * correct path for an agent's own outgoing channel (e.g. a decision log) — the
 * channel is owned by the agent contract, not the wallet, so a raw channel
 * write would be rejected.
 */
export async function publishAgentOutbound(
    params: AgentPublishParams,
    config: Config,
    wallet: WalletFile,
    options?: PublishOptions,
): Promise<PublishResult> {
    const { agentAddress, topic, payload, from } = params;
    const agent = contracts.getAgentWriteContract(agentAddress, config, wallet);
    const channelAddress = getAddress((await agent.read.getOutgoingMessagesChannel()) as Address);
    return submitPublication({
        channelAddress,
        topic,
        from,
        envelope: encode(topic, payload, from),
        config,
        wallet,
        options,
        write: (data, tx) => agent.write.publishOutbound([data], tx) as Promise<Hex>,
    });
}

/**
 * Publish a message to an agent's incoming channel through
 * SmartClawsAgent.publishInbound (requires SENDER_ROLE on the target agent).
 * This is the "notify" path: addressing another agent's inbox.
 */
export async function publishAgentInbound(
    params: AgentPublishParams,
    config: Config,
    wallet: WalletFile,
    options?: PublishOptions,
): Promise<PublishResult> {
    const { agentAddress, topic, payload, from } = params;
    const agent = contracts.getAgentWriteContract(agentAddress, config, wallet);
    const channelAddress = getAddress((await agent.read.getIncomingMessagesChannel()) as Address);
    return submitPublication({
        channelAddress,
        topic,
        from,
        envelope: encode(topic, payload, from),
        config,
        wallet,
        options,
        write: (data, tx) => agent.write.publishInbound([data], tx) as Promise<Hex>,
    });
}

export interface DiscloseParams {
    channelAddress: Address;
    fromOffset: number;
    count: number;
}

export interface DiscloseOptions {
    ctxRetry?: ctx.CtxRetryOptions;
}

export interface DiscloseResult {
    channel: Address;
    from: number;
    to: number;
    messages: ReadMessage[];
    txHash: Hex;
    ctxHashes: Hex[];
    /** Native value sent to fund the disclosure callback. A callback deposit, not the final cost. */
    callbackDeposit: bigint;
}

/**
 * Paid disclosure: requestMessages → wait for CTX → ECIES-decrypt → decode envelopes.
 * Free ciphertext reads stay on `readMessages`. Never splits a batch above 10 into
 * multiple paid transactions.
 */
export async function discloseMessages(
    params: DiscloseParams,
    config: Config,
    wallet: WalletFile,
    options?: DiscloseOptions,
): Promise<DiscloseResult> {
    const channelAddress = getAddress(params.channelAddress);
    if (!(await contracts.resolveChannelEncrypted(channelAddress, config))) {
        throw new SmartClawsError(
            "ENCRYPTION_UNSUPPORTED",
            "discloseMessages requires an encrypted channel.",
            { channel: channelAddress },
        );
    }
    if (
        !Number.isSafeInteger(params.count) ||
        params.count < 1 ||
        params.count > MAX_DISCLOSE_BATCH
    ) {
        throw new SmartClawsError(
            "READ_BATCH_LIMIT",
            `Disclosure count must be between 1 and ${MAX_DISCLOSE_BATCH}; larger ranges are not split into multiple paid transactions.`,
            { count: params.count, max: MAX_DISCLOSE_BATCH },
        );
    }
    if (!Number.isSafeInteger(params.fromOffset) || params.fromOffset < 0) {
        throw new SmartClawsError("INVALID_RANGE", "`fromOffset` must be a non-negative integer.", {
            fromOffset: params.fromOffset,
        });
    }

    const viewKey = keys.viewingPrivateKey(wallet);
    const reader = getAddress(wallet.address);
    const { publicClient } = contracts.getClients(config, wallet);

    if (!(await readers.isAuthorizedReader(channelAddress, reader, config))) {
        throw new SmartClawsError("NOT_A_READER", "Wallet is not an authorized reader.", {
            channel: channelAddress,
            reader,
        });
    }

    const registry = await contracts.resolvePublicKeyRegistryAddress(config);
    if (!(await keys.hasPublicKey(publicClient, registry, reader))) {
        throw new SmartClawsError("NO_PUBLIC_KEY", "Wallet has no registered public key.", {
            account: reader,
        });
    }

    const channel = contracts.getEncryptedChannelReadContract(channelAddress, config);
    const count = (await channel.read.getMessageCount()) as bigint;
    if (count === 0n) {
        throw new SmartClawsError("INVALID_RANGE", "Channel has no messages to disclose.", {
            channel: channelAddress,
        });
    }
    const oldest = (await channel.read.getOldestMessageOffset()) as bigint;
    const latest = (await channel.read.getLatestMessageOffset()) as bigint;
    const from = BigInt(params.fromOffset);
    const last = from + BigInt(params.count) - 1n;
    if (from < oldest || last > latest) {
        throw new SmartClawsError(
            "INVALID_RANGE",
            `Offsets ${params.fromOffset}..${Number(last)} are out of range; available offsets are ${oldest}..${latest}.`,
            {
                fromOffset: params.fromOffset,
                count: params.count,
                oldest: Number(oldest),
                latest: Number(latest),
            },
        );
    }

    const [payloads, offsets] = (await channel.read.readMessages([from, BigInt(params.count)])) as [
        readonly Hex[],
        readonly bigint[],
    ];

    const quote = await quoteReadFee(
        payloads,
        () => publicClient.getGasPrice(),
        (totalBytes, n) => channel.read.getReadCallbackGas([totalBytes, n]) as Promise<bigint>,
    );

    const writable = contracts.getEncryptedChannelContract(channelAddress, config, wallet);
    const hash = (await writable.write.requestMessages([from, BigInt(params.count)], {
        value: quote.value,
        gasPrice: quote.gasPrice,
    })) as Hex;

    let ctxResult: Awaited<ReturnType<typeof ctx.waitForCtxReceipts>>;
    try {
        ctxResult = await ctx.waitForCtxReceipts(
            publicClient as ctx.CtxClient,
            hash,
            options?.ctxRetry,
        );
    } catch (error) {
        if (error instanceof SmartClawsError && error.code === "CTX_NOT_FOUND") {
            throw new SmartClawsError(
                "DISCLOSURE_TIMEOUT",
                "No CTX has been crafted for the disclosure transaction yet",
                { originHash: hash },
            );
        }
        throw error;
    }

    const disclosed = collectDisclosedMessages(ctxResult.ctxReceipts, channelAddress, reader);
    verifyDisclosureCompleteness(
        disclosed,
        channelAddress,
        reader,
        params.fromOffset,
        params.count,
        offsets.map(Number),
    );
    disclosed.sort((left, right) => left.offset - right.offset);

    const messages: ReadMessage[] = disclosed.map((item) => {
        const env = keys.decryptDisclosedEnvelope(viewKey, item.encryptedPayload, decode);
        return {
            offset: item.offset,
            rawHex: item.encryptedPayload,
            encrypted: true,
            ...env,
        };
    });

    return {
        channel: channelAddress,
        from: params.fromOffset,
        to: params.fromOffset + params.count - 1,
        messages,
        txHash: hash,
        ctxHashes: ctxResult.ctxHashes,
        callbackDeposit: quote.value,
    };
}

interface SubmitTx {
    value: bigint;
    gasPrice?: bigint;
}

async function submitPublication(args: {
    channelAddress: Address;
    topic: string;
    from: string;
    envelope: Uint8Array;
    config: Config;
    wallet: WalletFile;
    options: PublishOptions | undefined;
    write: (data: Hex, tx: SubmitTx) => Promise<Hex>;
}): Promise<PublishResult> {
    const channelAddress = getAddress(args.channelAddress);
    const encrypted = await contracts.resolveChannelEncrypted(channelAddress, args.config);
    const { publicClient } = contracts.getClients(args.config, args.wallet);
    const wait = args.options?.wait ?? true;

    const base = {
        channel: channelAddress,
        topic: args.topic,
        dev: args.from,
        encrypted,
    };

    if (!encrypted) {
        const txHash = await args.write(toHex(args.envelope), { value: 0n });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receiptFailed(receipt)) {
            return { ...base, txHash, status: "origin-reverted" };
        }
        const confirmedOffset = publishedOffsetFromReceipts([receipt], channelAddress);
        if (confirmedOffset === undefined) {
            return { ...base, txHash, status: "ctx-reverted" };
        }
        return { ...base, txHash, status: "published", confirmedOffset };
    }

    const provider = args.options?.encryption ?? new BiteEncryptionProvider(args.config.rpcUrl);
    const ciphertext = await encryptForChannel(
        provider,
        args.envelope,
        getAddress(args.wallet.address),
        channelAddress,
    );
    const encryptedChannel = contracts.getEncryptedChannelReadContract(channelAddress, args.config);
    const fee = await quotePublishFee(
        ciphertext,
        () => publicClient.getGasPrice(),
        (ciphertextBytes) =>
            encryptedChannel.read.getPublishCallbackGas([ciphertextBytes]) as Promise<bigint>,
    );
    const txHash = await args.write(ciphertext, {
        value: fee.value,
        gasPrice: fee.gasPrice,
    });

    const withDeposit = { ...base, txHash, callbackDeposit: fee.value };

    if (!wait) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receiptFailed(receipt)) {
            return { ...base, txHash, status: "origin-reverted" };
        }
        return { ...withDeposit, status: "scheduled" };
    }

    try {
        const waited = await ctx.waitForCtxReceipts(
            publicClient as ctx.CtxClient,
            txHash,
            args.options?.ctxRetry,
        );
        const confirmedOffset = publishedOffsetFromReceipts(waited.ctxReceipts, channelAddress);
        if (confirmedOffset === undefined) {
            throw new SmartClawsError(
                "CTX_FAILED",
                "CTX succeeded without MessagePublished for this channel",
                { channel: channelAddress, ctxHashes: waited.ctxHashes },
            );
        }
        return {
            ...withDeposit,
            status: "published",
            ctxHashes: waited.ctxHashes,
            confirmedOffset,
        };
    } catch (error) {
        const status = publishStateFromError(error);
        if (status === undefined) throw error;
        if (status === "origin-reverted") {
            return { ...base, txHash, status };
        }
        return { ...withDeposit, status };
    }
}

function receiptFailed(receipt: unknown): boolean {
    if (!receipt || typeof receipt !== "object" || !("status" in receipt)) return false;
    const status = (receipt as { status: unknown }).status;
    return status === "reverted" || status === "0x0" || status === 0;
}

const ENCRYPTED_ABI = SmartClawsChannelEncryptedABI.abi as Abi;

function logsOf(receipt: unknown): unknown[] {
    if (!receipt || typeof receipt !== "object" || !("logs" in receipt)) return [];
    const logs = (receipt as { logs: unknown }).logs;
    return Array.isArray(logs) ? logs : [];
}

function publishedOffsetFromReceipts(
    receipts: readonly unknown[],
    channel: Address,
): number | undefined {
    const wanted = getAddress(channel);
    for (const receipt of receipts) {
        const events = parseEventLogs({
            abi: ENCRYPTED_ABI,
            logs: logsOf(receipt) as never,
            eventName: "MessagePublished",
            strict: false,
        }) as Array<{ args: { channel?: Address; offset?: bigint } }>;
        for (const event of events) {
            const eventChannel = event.args.channel;
            if (typeof eventChannel === "string" && getAddress(eventChannel) === wanted) {
                return Number(event.args.offset);
            }
        }
    }
    return undefined;
}

interface DisclosedItem {
    channel: Address;
    reader: Address;
    offset: number;
    encryptedPayload: Hex;
}

function collectDisclosedMessages(
    receipts: readonly unknown[],
    channel: Address,
    reader: Address,
): DisclosedItem[] {
    const wantedChannel = getAddress(channel);
    const wantedReader = getAddress(reader);
    const items: DisclosedItem[] = [];
    for (const receipt of receipts) {
        const events = parseEventLogs({
            abi: ENCRYPTED_ABI,
            logs: logsOf(receipt) as never,
            eventName: "MessageDisclosed",
            strict: false,
        }) as Array<{
            args: { channel?: Address; reader?: Address; offset?: bigint; encryptedPayload?: Hex };
        }>;
        for (const event of events) {
            const eventChannel = event.args.channel;
            const eventReader = event.args.reader;
            if (typeof eventChannel !== "string" || typeof eventReader !== "string") continue;
            if (getAddress(eventChannel) !== wantedChannel) continue;
            if (getAddress(eventReader) !== wantedReader) continue;
            const payload = event.args.encryptedPayload;
            if (typeof payload !== "string") continue;
            items.push({
                channel: wantedChannel,
                reader: wantedReader,
                offset: Number(event.args.offset),
                encryptedPayload: payload as Hex,
            });
        }
    }
    return items;
}

function verifyDisclosureCompleteness(
    items: readonly DisclosedItem[],
    channel: Address,
    reader: Address,
    fromOffset: number,
    count: number,
    expectedOffsets: readonly number[],
): void {
    const seen = new Set<number>();
    for (const item of items) {
        if (item.channel !== getAddress(channel) || item.reader !== getAddress(reader)) {
            throw new SmartClawsError(
                "CTX_FAILED",
                "MessageDisclosed event did not match the requested channel and reader",
                { channel, reader, eventChannel: item.channel, eventReader: item.reader },
            );
        }
        if (seen.has(item.offset)) {
            throw new SmartClawsError(
                "CTX_FAILED",
                "MessageDisclosed events contained a duplicate offset",
                { offset: item.offset },
            );
        }
        seen.add(item.offset);
    }

    const missing = expectedOffsets.filter((offset) => !seen.has(offset));
    if (missing.length > 0 || seen.size !== count) {
        throw new SmartClawsError(
            "CTX_FAILED",
            "CTX succeeded without a complete MessageDisclosed set",
            { channel, reader, fromOffset, count, disclosed: [...seen], missing },
        );
    }
}
