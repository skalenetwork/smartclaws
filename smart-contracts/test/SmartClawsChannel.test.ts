import { expect } from "chai";
import hre from "hardhat";
import { ethers as ethersLib } from "ethers";
import type { SmartClawsChannel, SmartClaws } from "../types/ethers-contracts/index.js";

async function getChannelFromReceipt(
  registry: SmartClaws,
  receipt: any
): Promise<string> {
  const event = receipt?.logs.find((log: any) => {
    try {
      return (
        registry.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        })?.name === "ChannelCreated"
      );
    } catch {
      return false;
    }
  });
  const parsed = registry.interface.parseLog({
    topics: event!.topics as string[],
    data: event!.data,
  });
  return parsed?.args.channel;
}

describe("SmartClawsChannel", function () {
  let ethers: any;
  let registry: SmartClaws;
  let channel: SmartClawsChannel;
  let owner: any;
  let publisher: any;
  let other: any;

  before(async function () {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
  });

  beforeEach(async function () {
    [owner, publisher, other] = await ethers.getSigners();

    const SmartClawsFactory =
      await ethers.getContractFactory("SmartClaws");
    registry = await SmartClawsFactory.deploy();
    await registry.waitForDeployment();

    const tx = await registry.createChannel(owner.address, 1024 * 1024);
    const receipt = await tx.wait();
    const channelAddress = await getChannelFromReceipt(registry, receipt);
    channel = await ethers.getContractAt(
      "SmartClawsChannel",
      channelAddress
    );
  });

  describe("Publishing", function () {
    it("should allow owner to publish a message", async function () {
      const payload = ethersLib.toUtf8Bytes(
        '{"v":1,"topic":"test","p":{"temp":24.5}}'
      );
      await expect(channel.publishMessage(payload))
        .to.emit(channel, "MessagePublished")
        .withArgs(await channel.getAddress(), 0);
    });

    it("should allow authorized publisher to publish", async function () {
      await channel.addPublisher(publisher.address);
      const payload = ethersLib.toUtf8Bytes("test");
      await expect(channel.connect(publisher).publishMessage(payload)).to.emit(
        channel,
        "MessagePublished"
      );
    });

    it("should reject unauthorized publisher", async function () {
      const payload = ethersLib.toUtf8Bytes("test");
      await expect(
        channel.connect(other).publishMessage(payload)
      ).to.be.revertedWithCustomError(channel, "Unauthorized");
    });

    it("should reject empty payload", async function () {
      await expect(
        channel.publishMessage("0x")
      ).to.be.revertedWithCustomError(channel, "EmptyPayload");
    });
  });

  describe("Reading", function () {
    it("should read a published message", async function () {
      const payload = ethersLib.toUtf8Bytes("hello");
      await channel.publishMessage(payload);

      const result = await channel.readMessage(0);
      expect(ethersLib.toUtf8String(result)).to.equal("hello");
    });

    it("should revert on empty channel", async function () {
      await expect(channel.readMessage(0)).to.be.revertedWithCustomError(
        channel,
        "ChannelEmpty"
      );
    });

    it("should return correct offsets", async function () {
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg1"));
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg2"));
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg3"));

      expect(await channel.getOldestMessageOffset()).to.equal(0);
      expect(await channel.getLatestMessageOffset()).to.equal(2);
      expect(await channel.getMessageCount()).to.equal(3);
    });
  });

  describe("Batch reading", function () {
    it("should return a batch of messages", async function () {
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg0"));
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg1"));
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg2"));

      const [payloads, offsets] = await channel.readMessages(0, 3);
      expect(payloads.length).to.equal(3);
      expect(offsets.length).to.equal(3);
      expect(ethersLib.toUtf8String(payloads[0])).to.equal("msg0");
      expect(ethersLib.toUtf8String(payloads[2])).to.equal("msg2");
      expect(offsets[0]).to.equal(0);
      expect(offsets[2]).to.equal(2);
    });

    it("should revert if batch exceeds available messages", async function () {
      await channel.publishMessage(ethersLib.toUtf8Bytes("msg0"));
      await expect(channel.readMessages(0, 5)).to.be.revertedWithCustomError(
        channel,
        "BatchTooLarge"
      );
    });
  });

  describe("Pruning", function () {
    it("should prune oldest messages when capacity is exceeded", async function () {
      const tx = await registry.createChannel(owner.address, 100);
      const receipt = await tx.wait();
      const tinyChannelAddress = await getChannelFromReceipt(registry, receipt);
      const tinyChannel = await ethers.getContractAt(
        "SmartClawsChannel",
        tinyChannelAddress
      );

      const bigPayload = ethersLib.toUtf8Bytes("x".repeat(60));
      await tinyChannel.publishMessage(bigPayload);
      await tinyChannel.publishMessage(bigPayload);

      await expect(tinyChannel.readMessage(0)).to.be.revertedWithCustomError(
        tinyChannel,
        "MessagePruned"
      );

      const result = await tinyChannel.readMessage(1);
      expect(ethersLib.dataLength(result)).to.equal(60);
    });
  });

  describe("Writes disabled", function () {
    it("should reject publishes after writes are disabled", async function () {
      await channel.disableWrites();
      const payload = ethersLib.toUtf8Bytes("test");
      await expect(
        channel.publishMessage(payload)
      ).to.be.revertedWithCustomError(channel, "WritesAreDisabled");
    });

    it("should still allow reads after writes are disabled", async function () {
      await channel.publishMessage(
        ethersLib.toUtf8Bytes("before-disable")
      );
      await channel.disableWrites();
      const result = await channel.readMessage(0);
      expect(ethersLib.toUtf8String(result)).to.equal("before-disable");
    });
  });
});
