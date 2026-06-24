import SmartClawsChannelABI from "@smartclaws/core/abi/SmartClawsChannel.json" with {
  type: "json",
};
import { decode, encode } from "@smartclaws/core/envelope";
import type { Config, WalletFile } from "@smartclaws/core/types";
import { type Address, getContract, toBytes, toHex } from "viem";
import { createClient } from "../client.js";
import { getChannelContract, getClients, getDeviceWriteContract } from "../contracts.js";
import { loadDevice } from "../device.js";
import { SmartClawsError } from "../errors.js";

export interface ChannelTarget {
  /** Local device name; reads/writes its outgoing channel. */
  device?: string;
  /** Direct channel address (mutually exclusive with `device`). */
  channel?: string;
}

export interface ResolvedChannel {
  channelAddress: Address;
  device?: string;
  deviceAddress?: Address;
}

/**
 * Resolve a `{ device }` or `{ channel }` target to a channel address. Throws
 * `INVALID_TARGET` if neither/both are given, or `DEVICE_NOT_FOUND` if the named
 * device has no local record. Read-only; no wallet required. `homeDir` overrides
 * the SmartClaws home used to look up local device records.
 */
export function resolveChannel(target: ChannelTarget, homeDir?: string): ResolvedChannel {
  const hasDevice = Boolean(target.device);
  const hasChannel = Boolean(target.channel);
  if (hasDevice === hasChannel) {
    throw new SmartClawsError("INVALID_TARGET", "Provide exactly one of `device` or `channel`.");
  }

  if (target.channel) {
    return { channelAddress: target.channel as Address };
  }

  const device = loadDevice(target.device as string, homeDir);
  if (!device) {
    throw new SmartClawsError("DEVICE_NOT_FOUND", `Device '${target.device}' not found.`, {
      device: target.device,
    });
  }
  return {
    channelAddress: device.outgoingChannel as Address,
    device: device.name,
    deviceAddress: device.deviceContract as Address,
  };
}

export interface ReadMessage {
  offset: number;
  /** Raw on-chain payload as hex; always present. */
  rawHex: `0x${string}`;
  /** True when the payload could not be decoded as a SmartClaws envelope. */
  decodeError?: boolean;
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
  messages: ReadMessage[];
}

export interface ReadParams {
  channelAddress: Address;
  limit?: number;
  offset?: number;
}

/**
 * Read decoded messages from a channel. Read-only: uses a public client, no
 * wallet/signing. Mirrors the offset/limit windowing of the CLI `read` command.
 */
export async function readMessages(params: ReadParams, config: Config): Promise<ReadResult> {
  const { channelAddress } = params;

  if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit <= 0)) {
    throw new SmartClawsError("INVALID_RANGE", "`limit` must be a positive integer.", {
      limit: params.limit,
    });
  }
  if (params.offset !== undefined && (!Number.isSafeInteger(params.offset) || params.offset < 0)) {
    throw new SmartClawsError("INVALID_RANGE", "`offset` must be a non-negative integer.", {
      offset: params.offset,
    });
  }
  const limitReq = BigInt(params.limit ?? 10);

  const publicClient = createClient(config);
  const channel = getContract({
    address: channelAddress,
    abi: SmartClawsChannelABI.abi,
    client: publicClient,
  });

  const count = (await channel.read.getMessageCount()) as bigint;
  if (count === 0n) {
    return {
      channel: channelAddress,
      total: 0,
      oldest: 0,
      latest: 0,
      from: 0,
      to: 0,
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

export interface PublishResult {
  channel: Address;
  topic: string;
  dev: string;
  txHash: `0x${string}`;
  status: "success" | "reverted";
}

/**
 * Encode and publish an envelope to a channel. Requires a wallet (signs the
 * transaction). Returns the transaction hash and receipt status.
 */
export async function publishMessage(
  params: PublishParams,
  config: Config,
  wallet: WalletFile,
): Promise<PublishResult> {
  const { channelAddress, topic, payload, from } = params;
  const encoded = encode(topic, payload, from);
  const channel = getChannelContract(channelAddress, config, wallet);
  const { publicClient } = getClients(config, wallet);

  const hash = await channel.write.publishMessage([toHex(encoded)]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    channel: channelAddress,
    topic,
    dev: from,
    txHash: hash,
    status: receipt.status,
  };
}

export interface DevicePublishParams {
  deviceAddress: Address;
  topic: string;
  payload: Record<string, unknown>;
  /** Envelope `dev` field — usually the device id/name. */
  from: string;
}

/**
 * Publish telemetry through SmartClawsDevice.publishTelemetry so the device
 * contract enforces PUBLISHER_ROLE and channel ownership correctly.
 */
export async function publishDeviceTelemetry(
  params: DevicePublishParams,
  config: Config,
  wallet: WalletFile,
): Promise<PublishResult> {
  const { deviceAddress, topic, payload, from } = params;
  const encoded = encode(topic, payload, from);
  const device = getDeviceWriteContract(deviceAddress, config, wallet);
  const { publicClient } = getClients(config, wallet);

  const hash = await device.write.publishTelemetry([toHex(encoded)]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const outgoingChannel = (await device.read.getOutgoingMessagesChannel()) as Address;

  return {
    channel: outgoingChannel,
    topic,
    dev: from,
    txHash: hash,
    status: receipt.status,
  };
}
