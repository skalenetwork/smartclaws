import { beforeAll, describe, expect, test } from "bun:test";
import { toBytes, toHex, type Address } from "viem";
import { decode, encode } from "@smartclaws/core/envelope";
import {
  createChannel,
  createOtherWalletChannel,
  deployRegistry,
  getChannelContract,
  publicClient,
} from "../setup.ts";

const OTHER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

function rawPayload(text: string): `0x${string}` {
  return toHex(new TextEncoder().encode(text));
}

describe("SmartClawsChannel (anvil)", () => {
  let registryAddress: Address;
  let channelAddress: Address;
  let channel: ReturnType<typeof getChannelContract>;

  beforeAll(async () => {
    registryAddress = await deployRegistry();
    channelAddress = await createChannel(registryAddress);
    channel = getChannelContract(channelAddress);
  });

  test("publish and read a message", async () => {
    const payload = toHex(encode("temperature", { temp: 24.5 }, "sc_dev_test", 1711324800));

    const hash = await channel.write.publishMessage([payload]);
    await publicClient.waitForTransactionReceipt({ hash });

    const result = await channel.read.readMessage([0n]);
    const envelope = decode(toBytes(result));
    expect(envelope.topic).toBe("temperature");
    expect(envelope.p).toEqual({ temp: 24.5 });
  });

  test("read message count and offsets", async () => {
    const count = await channel.read.getMessageCount();
    expect(count).toBeGreaterThanOrEqual(1n);

    const oldest = await channel.read.getOldestMessageOffset();
    expect(oldest).toBe(0n);

    const latest = await channel.read.getLatestMessageOffset();
    expect(latest).toBeGreaterThanOrEqual(0n);
  });

  test("reject unauthorized publisher", async () => {
    const otherChannel = createOtherWalletChannel(channelAddress, OTHER_PRIVATE_KEY);

    try {
      const hash = await otherChannel.write.publishMessage([rawPayload("unauthorized")]);
      await publicClient.waitForTransactionReceipt({ hash });
      throw new Error("expected revert");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("Unauthorized");
    }
  });

  test("reject empty payload", async () => {
    try {
      const hash = await channel.write.publishMessage(["0x"]);
      await publicClient.waitForTransactionReceipt({ hash });
      throw new Error("expected revert");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("EmptyPayload");
    }
  });

  test("batch read messages", async () => {
    for (const msg of ["msg1", "msg2"]) {
      const hash = await channel.write.publishMessage([rawPayload(msg)]);
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const count = await channel.read.getMessageCount();
    const [payloads, offsets] = await channel.read.readMessages([0n, count]);
    expect(payloads.length).toBe(Number(count));
    expect(offsets.length).toBe(Number(count));
  });

  test("pruning on small-capacity channel", async () => {
    const tinyChannelAddress = await createChannel(registryAddress, 100);
    const tinyChannel = getChannelContract(tinyChannelAddress);

    const bigPayload = rawPayload("x".repeat(60));
    let hash = await tinyChannel.write.publishMessage([bigPayload]);
    await publicClient.waitForTransactionReceipt({ hash });

    hash = await tinyChannel.write.publishMessage([bigPayload]);
    await publicClient.waitForTransactionReceipt({ hash });

    try {
      await tinyChannel.read.readMessage([0n]);
      throw new Error("expected revert");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("MessagePruned");
    }

    const result = await tinyChannel.read.readMessage([1n]);
    expect(result).toBeDefined();
  });

  test("disable writes", async () => {
    const freshChannelAddress = await createChannel(registryAddress);
    const freshChannel = getChannelContract(freshChannelAddress);

    let hash = await freshChannel.write.publishMessage([rawPayload("before-disable")]);
    await publicClient.waitForTransactionReceipt({ hash });

    hash = await freshChannel.write.disableWrites();
    await publicClient.waitForTransactionReceipt({ hash });

    try {
      hash = await freshChannel.write.publishMessage([rawPayload("after")]);
      await publicClient.waitForTransactionReceipt({ hash });
      throw new Error("expected revert");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("WritesAreDisabled");
    }

    const result = await freshChannel.read.readMessage([0n]);
    expect(new TextDecoder().decode(toBytes(result))).toBe("before-disable");
  });
});
