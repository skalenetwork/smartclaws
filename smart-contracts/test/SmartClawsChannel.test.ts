import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import type {
    SmartClawsChannel,
    SmartClaws,
    ChannelFactory,
} from "../types/ethers-contracts/index.js";
import { ONE_MB, loadFixture, deployChannelFixture, createChannel } from "./helpers/deploy.js";

describe("SmartClawsChannel", function () {
    let ethers: any;
    let registry: SmartClaws;
    let channelFactory: ChannelFactory;
    let channel: SmartClawsChannel;
    let owner: any;
    let publisher: any;
    let other: any;

    beforeEach(async function () {
        const fx = await loadFixture(deployChannelFixture);
        ethers = fx.ethers;
        registry = fx.registry;
        channel = fx.channel;
        [owner, publisher, other] = fx.signers;
        channelFactory = await ethers.getContractAt("ChannelFactory", fx.channelFactory);
    });

    describe("Deployment", function () {
        it("should expose capacity, registry, owner and enabled writes", async function () {
            expect(await channel.maxCapacityBytes()).to.equal(ONE_MB);
            expect(await channel.registry()).to.equal(await registry.getAddress());
            expect(await channel.owner()).to.equal(owner.address);
            expect(await channel.writesEnabled()).to.equal(true);
        });

        it("should reject zero capacity at construction", async function () {
            await expect(
                channelFactory.createChannel(owner.address, 0, await registry.getAddress()),
            ).to.be.revertedWithCustomError(channel, "ZeroCapacity");
        });

        it("should reject a zero registry at construction", async function () {
            await expect(
                channelFactory.createChannel(owner.address, ONE_MB, ethersLib.ZeroAddress),
            ).to.be.revertedWithCustomError(channel, "InvalidRegistryAddress");
        });
    });

    describe("Publishing", function () {
        it("should allow owner to publish a message", async function () {
            const payload = ethersLib.toUtf8Bytes('{"v":1,"topic":"test","p":{"temp":24.5}}');
            await expect(channel.publishMessage(payload))
                .to.emit(channel, "MessagePublished")
                .withArgs(await channel.getAddress(), 0);
        });

        it("should allow authorized publisher to publish", async function () {
            await channel.addPublisher(publisher.address);
            const payload = ethersLib.toUtf8Bytes("test");
            await expect(channel.connect(publisher).publishMessage(payload)).to.emit(
                channel,
                "MessagePublished",
            );
        });

        it("should reject unauthorized publisher", async function () {
            const payload = ethersLib.toUtf8Bytes("test");
            await expect(
                channel.connect(other).publishMessage(payload),
            ).to.be.revertedWithCustomError(channel, "Unauthorized");
        });

        it("should reject empty payload", async function () {
            await expect(channel.publishMessage("0x")).to.be.revertedWithCustomError(
                channel,
                "EmptyPayload",
            );
        });

        it("should reject a payload exceeding capacity", async function () {
            const tiny = await createChannel(ethers, registry, owner.address, 32);
            const tooBig = ethersLib.toUtf8Bytes("x".repeat(33));
            await expect(tiny.publishMessage(tooBig)).to.be.revertedWithCustomError(
                tiny,
                "PayloadExceedsCapacity",
            );
        });
    });

    describe("Publisher management", function () {
        it("should add a publisher, emit, and reflect authorization", async function () {
            await expect(channel.addPublisher(publisher.address))
                .to.emit(channel, "PublisherAdded")
                .withArgs(publisher.address);

            expect(await channel.isAuthorizedPublisher(publisher.address)).to.equal(true);
            expect(await channel.getPublishers()).to.deep.equal([publisher.address]);
        });

        it("should reject addPublisher from a non-owner", async function () {
            await expect(
                channel.connect(other).addPublisher(publisher.address),
            ).to.be.revertedWithCustomError(channel, "OwnableUnauthorizedAccount");
        });

        it("should reject adding the owner as publisher", async function () {
            await expect(channel.addPublisher(owner.address)).to.be.revertedWithCustomError(
                channel,
                "CannotModifyOwnerAsPublisher",
            );
        });

        it("should reject adding a duplicate publisher", async function () {
            await channel.addPublisher(publisher.address);
            await expect(channel.addPublisher(publisher.address)).to.be.revertedWithCustomError(
                channel,
                "PublisherAlreadyAuthorized",
            );
        });

        it("should remove a publisher, emit, and clear authorization", async function () {
            await channel.addPublisher(publisher.address);
            await expect(channel.removePublisher(publisher.address))
                .to.emit(channel, "PublisherRemoved")
                .withArgs(publisher.address);

            expect(await channel.isAuthorizedPublisher(publisher.address)).to.equal(false);
            expect(await channel.getPublishers()).to.deep.equal([]);
        });

        it("should reject removing a non-publisher", async function () {
            await expect(channel.removePublisher(publisher.address)).to.be.revertedWithCustomError(
                channel,
                "PublisherNotAuthorized",
            );
        });

        it("should reject removing the owner as publisher", async function () {
            await expect(channel.removePublisher(owner.address)).to.be.revertedWithCustomError(
                channel,
                "CannotModifyOwnerAsPublisher",
            );
        });

        it("should treat the owner as an authorized publisher", async function () {
            expect(await channel.isAuthorizedPublisher(owner.address)).to.equal(true);
        });

        it("should paginate publishers", async function () {
            await channel.addPublisher(publisher.address);
            await channel.addPublisher(other.address);
            const all = await channel.getPublishers();

            expect(await channel.getPublishers(0, 1)).to.deep.equal([all[0]]);
            expect(await channel.getPublishers(1, 5)).to.deep.equal([all[1]]);
            expect(await channel.getPublishers(2, 5)).to.deep.equal([]);
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
                "ChannelEmpty",
            );
        });

        it("should revert reading an offset at or beyond the next offset", async function () {
            await channel.publishMessage(ethersLib.toUtf8Bytes("msg0"));
            await expect(channel.readMessage(1)).to.be.revertedWithCustomError(
                channel,
                "InvalidOffset",
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

        it("should return an empty batch for zero count", async function () {
            await channel.publishMessage(ethersLib.toUtf8Bytes("msg0"));
            const [payloads, offsets] = await channel.readMessages(0, 0);

            expect(payloads).to.deep.equal([]);
            expect(offsets).to.deep.equal([]);
        });

        it("should revert if batch exceeds available messages", async function () {
            await channel.publishMessage(ethersLib.toUtf8Bytes("msg0"));
            await expect(channel.readMessages(0, 5)).to.be.revertedWithCustomError(
                channel,
                "BatchTooLarge",
            );
        });

        it("should revert reading a batch that starts in a pruned range", async function () {
            const tiny = await createChannel(ethers, registry, owner.address, 100);
            const bigPayload = ethersLib.toUtf8Bytes("x".repeat(60));
            await tiny.publishMessage(bigPayload);
            await tiny.publishMessage(bigPayload);

            await expect(tiny.readMessages(0, 1)).to.be.revertedWithCustomError(
                tiny,
                "MessagePruned",
            );
        });
    });

    describe("Pruning", function () {
        it("should prune oldest messages when capacity is exceeded", async function () {
            const tinyChannel = await createChannel(ethers, registry, owner.address, 100);

            const bigPayload = ethersLib.toUtf8Bytes("x".repeat(60));
            await tinyChannel.publishMessage(bigPayload);
            await tinyChannel.publishMessage(bigPayload);

            await expect(tinyChannel.readMessage(0)).to.be.revertedWithCustomError(
                tinyChannel,
                "MessagePruned",
            );

            const result = await tinyChannel.readMessage(1);
            expect(ethersLib.dataLength(result)).to.equal(60);
        });

        it("should advance the oldest offset and keep the count accurate after pruning", async function () {
            const tinyChannel = await createChannel(ethers, registry, owner.address, 100);
            const bigPayload = ethersLib.toUtf8Bytes("x".repeat(60));
            await tinyChannel.publishMessage(bigPayload);
            await tinyChannel.publishMessage(bigPayload);

            expect(await tinyChannel.getOldestMessageOffset()).to.equal(1);
            expect(await tinyChannel.getLatestMessageOffset()).to.equal(1);
            expect(await tinyChannel.getMessageCount()).to.equal(1);
        });
    });

    describe("Writes disabled", function () {
        it("should reject publishes after writes are disabled", async function () {
            await channel.disableWrites();
            const payload = ethersLib.toUtf8Bytes("test");
            await expect(channel.publishMessage(payload)).to.be.revertedWithCustomError(
                channel,
                "WritesAreDisabled",
            );
        });

        it("should still allow reads after writes are disabled", async function () {
            await channel.publishMessage(ethersLib.toUtf8Bytes("before-disable"));
            await channel.disableWrites();
            const result = await channel.readMessage(0);
            expect(ethersLib.toUtf8String(result)).to.equal("before-disable");
        });

        it("should reject disableWrites from a non-owner, non-registry caller", async function () {
            await expect(channel.connect(other).disableWrites()).to.be.revertedWithCustomError(
                channel,
                "Unauthorized",
            );
        });

        it("should treat a second disableWrites as a no-op", async function () {
            await expect(channel.disableWrites()).to.emit(channel, "WritesDisabled");
            await expect(channel.disableWrites()).to.not.emit(channel, "WritesDisabled");
            expect(await channel.writesEnabled()).to.equal(false);
        });
    });

    describe("Manual prune", function () {
        async function fill(c: SmartClawsChannel, n: number) {
            for (let i = 0; i < n; i++) {
                await c.publishMessage(ethersLib.toUtf8Bytes(`msg${i}`));
            }
        }

        it("should evict up to maxMessages oldest and advance the window", async function () {
            await fill(channel, 5);

            await expect(channel.prune(2))
                .to.emit(channel, "MessagesPruned")
                .withArgs(await channel.getAddress(), 2, 2);

            expect(await channel.startOffset()).to.equal(2);
            expect(await channel.getMessageCount()).to.equal(3);
            expect(await channel.getOldestMessageOffset()).to.equal(2);
            await expect(channel.readMessage(1)).to.be.revertedWithCustomError(
                channel,
                "MessagePruned",
            );
        });

        it("should clamp to the number available and free byte budget", async function () {
            await fill(channel, 3);
            const tx = await channel.prune(100);
            const receipt = await tx.wait();
            // Only 3 were available.
            expect(await channel.getMessageCount()).to.equal(0);
            expect(await channel.totalBytes()).to.equal(0);
            // Event reports the actual count (3), not the requested 100.
            const ev = receipt!.logs
                .map((l: any) => channel.interface.parseLog(l))
                .find((p: any) => p?.name === "MessagesPruned");
            expect(ev.args.prunedCount).to.equal(3);
        });

        it("should treat a fully pruned channel as empty for offset helpers", async function () {
            await fill(channel, 2);
            await channel.prune(2);

            expect(await channel.getMessageCount()).to.equal(0);
            await expect(channel.getOldestMessageOffset()).to.be.revertedWithCustomError(
                channel,
                "ChannelEmpty",
            );
            await expect(channel.getLatestMessageOffset()).to.be.revertedWithCustomError(
                channel,
                "ChannelEmpty",
            );
        });

        it("should be a no-op (no event) on an empty channel", async function () {
            await expect(channel.prune(5)).to.not.emit(channel, "MessagesPruned");
            expect(await channel.startOffset()).to.equal(0);
        });

        it("should let pruning make room so a large publish never evicts in one tx", async function () {
            const tiny = await createChannel(ethers, registry, owner.address, 100);
            // Fill with small messages (5 * ~4 bytes = 20 bytes, well under 100).
            await fill(tiny, 5);
            // Trim the backlog first, then publish a near-capacity message.
            await tiny.prune(5);
            const big = ethersLib.toUtf8Bytes("x".repeat(90));
            await expect(tiny.publishMessage(big)).to.emit(tiny, "MessagePublished");
        });

        it("should reject prune from a non-owner caller", async function () {
            await expect(channel.connect(other).prune(1)).to.be.revertedWithCustomError(
                channel,
                "OwnableUnauthorizedAccount",
            );
        });
    });

    describe("Pausing", function () {
        const payload = () => ethersLib.toUtf8Bytes("test");

        it("should reject publishes while paused and resume after unpause", async function () {
            await expect(channel.pause()).to.emit(channel, "Paused");
            expect(await channel.paused()).to.equal(true);

            await expect(channel.publishMessage(payload())).to.be.revertedWithCustomError(
                channel,
                "EnforcedPause",
            );

            await expect(channel.unpause()).to.emit(channel, "Unpaused");
            expect(await channel.paused()).to.equal(false);
            await expect(channel.publishMessage(payload())).to.emit(channel, "MessagePublished");
        });

        it("should still allow reads while paused", async function () {
            await channel.publishMessage(payload());
            await channel.pause();
            expect(await channel.getMessageCount()).to.equal(1);
            expect(ethersLib.dataLength(await channel.readMessage(0))).to.equal(4);
        });

        it("should reject duplicate pause and unpause when already unpaused", async function () {
            await expect(channel.unpause()).to.be.revertedWithCustomError(channel, "ExpectedPause");
            await channel.pause();
            await expect(channel.pause()).to.be.revertedWithCustomError(channel, "EnforcedPause");
        });

        it("should let the registry pause and unpause", async function () {
            // The registry is authorized alongside the owner (onlyOwnerOrRegistry).
            const registryAddr = await registry.getAddress();
            await ethers.provider.send("hardhat_impersonateAccount", [registryAddr]);
            await ethers.provider.send("hardhat_setBalance", [
                registryAddr,
                "0x1000000000000000000",
            ]);
            const asRegistry = await ethers.getSigner(registryAddr);
            await expect(channel.connect(asRegistry).pause()).to.emit(channel, "Paused");
            await expect(channel.connect(asRegistry).unpause()).to.emit(channel, "Unpaused");
            await ethers.provider.send("hardhat_stopImpersonatingAccount", [registryAddr]);
        });

        it("should reject pause/unpause from a non-owner, non-registry caller", async function () {
            await expect(channel.connect(other).pause()).to.be.revertedWithCustomError(
                channel,
                "Unauthorized",
            );
        });

        it("should keep the permanent gate dominant: unpause cannot revive disabled writes", async function () {
            await channel.pause();
            await channel.disableWrites();
            await channel.unpause();
            expect(await channel.paused()).to.equal(false);
            expect(await channel.writesEnabled()).to.equal(false);
            await expect(channel.publishMessage(payload())).to.be.revertedWithCustomError(
                channel,
                "WritesAreDisabled",
            );
        });
    });
});
