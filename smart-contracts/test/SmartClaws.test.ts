import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import type { SmartClaws } from "../types/ethers-contracts/index.js";
import {
    ONE_MB,
    loadFixture,
    deploySystemFixture,
    createChannel,
    createDeviceGroup,
    createAgent,
    getAddressFromReceipt,
} from "./helpers/deploy.js";

describe("SmartClaws", function () {
    let ethers: any;
    let registry: SmartClaws;
    let factories: string[];
    let owner: any;
    let other: any;

    beforeEach(async function () {
        const fx = await loadFixture(deploySystemFixture);
        ethers = fx.ethers;
        registry = fx.registry;
        factories = [fx.channelFactory, fx.deviceFactory, fx.deviceGroupFactory, fx.agentFactory];
        [owner, other] = fx.signers;
    });

    describe("Deployment", function () {
        it("should store the four factory addresses", async function () {
            expect(await registry.channelFactory()).to.equal(factories[0]);
            expect(await registry.deviceFactory()).to.equal(factories[1]);
            expect(await registry.deviceGroupFactory()).to.equal(factories[2]);
            expect(await registry.agentFactory()).to.equal(factories[3]);
        });

        const slots = ["channel", "device", "deviceGroup", "agent"];
        slots.forEach((label, index) => {
            it(`should reject a zero ${label} factory`, async function () {
                const SmartClawsFactory = await ethers.getContractFactory("SmartClaws");
                const args = [...factories];
                args[index] = ethersLib.ZeroAddress;
                await expect(SmartClawsFactory.deploy(...args)).to.be.revertedWithCustomError(
                    registry,
                    "InvalidFactoryAddress",
                );
            });
        });
    });

    describe("Channels", function () {
        it("should create and register a channel", async function () {
            const channel = await createChannel(ethers, registry, owner.address, ONE_MB);
            const channelAddr = await channel.getAddress();

            expect(await registry.isRegisteredChannel(channelAddr)).to.equal(true);
            expect(await registry.getChannelCount()).to.equal(1);
            expect(await registry.getChannels()).to.deep.equal([channelAddr]);
            expect(await channel.owner()).to.equal(owner.address);
            expect(await channel.registry()).to.equal(await registry.getAddress());
        });

        it("should emit ChannelCreated", async function () {
            await expect(registry.createChannel(owner.address, ONE_MB)).to.emit(
                registry,
                "ChannelCreated",
            );
        });

        it("should track multiple channels", async function () {
            await createChannel(ethers, registry, owner.address, ONE_MB);
            await createChannel(ethers, registry, owner.address, ONE_MB);
            expect(await registry.getChannelCount()).to.equal(2);
        });

        it("should paginate channels and clamp out-of-range offsets", async function () {
            await createChannel(ethers, registry, owner.address, ONE_MB);
            await createChannel(ethers, registry, owner.address, ONE_MB);
            await createChannel(ethers, registry, owner.address, ONE_MB);
            const all = await registry.getChannels();

            expect(await registry.getChannels(0, 2)).to.deep.equal(all.slice(0, 2));
            expect(await registry.getChannels(2, 10)).to.deep.equal(all.slice(2));
            expect(await registry.getChannels(5, 10)).to.deep.equal([]);
        });

        it("should delete a channel, disable writes, and keep reads working", async function () {
            const channel = await createChannel(ethers, registry, owner.address, ONE_MB);
            const channelAddr = await channel.getAddress();
            await channel.publishMessage(ethersLib.toUtf8Bytes("kept"));

            await expect(registry.deleteChannel(channelAddr))
                .to.emit(registry, "ChannelDeleted")
                .withArgs(channelAddr);

            expect(await registry.isRegisteredChannel(channelAddr)).to.equal(false);
            expect(await registry.getChannelCount()).to.equal(0);
            expect(await channel.writesEnabled()).to.equal(false);
            expect(ethersLib.toUtf8String(await channel.readMessage(0))).to.equal("kept");
        });

        it("should reject deleting an unregistered channel", async function () {
            await expect(registry.deleteChannel(other.address)).to.be.revertedWithCustomError(
                registry,
                "ChannelNotRegistered",
            );
        });

        it("should reject deletion by a non-owner", async function () {
            const channel = await createChannel(ethers, registry, owner.address, ONE_MB);
            await expect(
                registry.connect(other).deleteChannel(await channel.getAddress()),
            ).to.be.revertedWithCustomError(registry, "NotChannelOwner");
        });
    });

    describe("Device groups", function () {
        it("should register a device group owned by the caller", async function () {
            const group = await createDeviceGroup(ethers, registry, owner);
            const groupAddr = await group.getAddress();

            expect(await registry.isRegisteredDeviceGroup(groupAddr)).to.equal(true);
            expect(await registry.getDeviceGroupCount()).to.equal(1);
            expect(await registry.getDeviceGroups()).to.deep.equal([groupAddr]);
            expect(await group.owner()).to.equal(owner.address);
        });

        it("should store the device group creation timestamp", async function () {
            const tx = await registry.connect(owner).registerDeviceGroup("timed", "skills");
            const receipt = await tx.wait();
            const groupAddr = getAddressFromReceipt(
                registry,
                receipt,
                "DeviceGroupRegistered",
                "deviceGroup",
            );
            const block = await ethers.provider.getBlock(receipt!.blockNumber);
            const group = await ethers.getContractAt("SmartClawsDeviceGroup", groupAddr);

            expect(await group.createdAt()).to.equal(block!.timestamp);
        });

        it("should emit DeviceGroupRegistered", async function () {
            await expect(registry.registerDeviceGroup("g", "s")).to.emit(
                registry,
                "DeviceGroupRegistered",
            );
        });

        it("should paginate device groups and clamp out-of-range offsets", async function () {
            await createDeviceGroup(ethers, registry, owner, "g1", "s1");
            await createDeviceGroup(ethers, registry, owner, "g2", "s2");
            await createDeviceGroup(ethers, registry, owner, "g3", "s3");
            const all = await registry.getDeviceGroups();

            expect(await registry.getDeviceGroups(0, 2)).to.deep.equal(all.slice(0, 2));
            expect(await registry.getDeviceGroups(2, 10)).to.deep.equal(all.slice(2));
            expect(await registry.getDeviceGroups(5, 10)).to.deep.equal([]);
        });

        it("should unregister a device group and deactivate it", async function () {
            const group = await createDeviceGroup(ethers, registry, owner);
            const groupAddr = await group.getAddress();

            await expect(registry.connect(owner).unregisterDeviceGroup(groupAddr))
                .to.emit(registry, "DeviceGroupUnregistered")
                .withArgs(groupAddr);

            expect(await registry.isRegisteredDeviceGroup(groupAddr)).to.equal(false);
            expect(await group.active()).to.equal(false);
        });

        it("should reject unregistering an unknown group", async function () {
            await expect(
                registry.unregisterDeviceGroup(other.address),
            ).to.be.revertedWithCustomError(registry, "DeviceGroupNotRegistered");
        });

        it("should reject unregistration by a non-owner", async function () {
            const group = await createDeviceGroup(ethers, registry, owner);
            await expect(
                registry.connect(other).unregisterDeviceGroup(await group.getAddress()),
            ).to.be.revertedWithCustomError(registry, "NotGroupOwner");
        });
    });

    describe("Agents", function () {
        it("should register an agent owned by the caller with two channels", async function () {
            const agent = await createAgent(ethers, registry, owner, ONE_MB);
            const agentAddr = await agent.getAddress();

            expect(await registry.isRegisteredAgent(agentAddr)).to.equal(true);
            expect(await registry.getAgentCount()).to.equal(1);
            expect(await registry.getAgents()).to.deep.equal([agentAddr]);
            expect(await agent.owner()).to.equal(owner.address);

            const incoming = await agent.getIncomingMessagesChannel();
            const outgoing = await agent.getOutgoingMessagesChannel();
            expect(incoming).to.not.equal(outgoing);
            expect(incoming).to.not.equal(ethersLib.ZeroAddress);
        });

        it("should emit AgentRegistered", async function () {
            await expect(registry.registerAgent("a", "m", ONE_MB)).to.emit(
                registry,
                "AgentRegistered",
            );
        });

        it("should store the agent creation timestamp", async function () {
            const tx = await registry
                .connect(owner)
                .registerAgent("timed-agent", "metadata", ONE_MB);
            const receipt = await tx.wait();
            const agentAddr = getAddressFromReceipt(registry, receipt, "AgentRegistered", "agent");
            const block = await ethers.provider.getBlock(receipt!.blockNumber);
            const agent = await ethers.getContractAt("SmartClawsAgent", agentAddr);

            expect(await agent.createdAt()).to.equal(block!.timestamp);
        });

        it("should paginate agents and clamp out-of-range offsets", async function () {
            await createAgent(ethers, registry, owner, ONE_MB, "a1", "m1");
            await createAgent(ethers, registry, owner, ONE_MB, "a2", "m2");
            await createAgent(ethers, registry, owner, ONE_MB, "a3", "m3");
            const all = await registry.getAgents();

            expect(await registry.getAgents(0, 2)).to.deep.equal(all.slice(0, 2));
            expect(await registry.getAgents(2, 10)).to.deep.equal(all.slice(2));
            expect(await registry.getAgents(5, 10)).to.deep.equal([]);
        });

        it("should unregister an agent, deactivate it, and disable both channels", async function () {
            const agent = await createAgent(ethers, registry, owner, ONE_MB);
            const agentAddr = await agent.getAddress();
            const incoming = await ethers.getContractAt(
                "SmartClawsChannel",
                await agent.getIncomingMessagesChannel(),
            );
            const outgoing = await ethers.getContractAt(
                "SmartClawsChannel",
                await agent.getOutgoingMessagesChannel(),
            );

            await expect(registry.connect(owner).unregisterAgent(agentAddr))
                .to.emit(registry, "AgentUnregistered")
                .withArgs(agentAddr);

            expect(await registry.isRegisteredAgent(agentAddr)).to.equal(false);
            expect(await agent.active()).to.equal(false);
            expect(await incoming.writesEnabled()).to.equal(false);
            expect(await outgoing.writesEnabled()).to.equal(false);
        });

        it("should reject unregistering an unknown agent", async function () {
            await expect(registry.unregisterAgent(other.address)).to.be.revertedWithCustomError(
                registry,
                "AgentNotRegistered",
            );
        });

        it("should reject unregistration by a non-owner", async function () {
            const agent = await createAgent(ethers, registry, owner, ONE_MB);
            await expect(
                registry.connect(other).unregisterAgent(await agent.getAddress()),
            ).to.be.revertedWithCustomError(registry, "NotAgentOwner");
        });
    });

    describe("Views", function () {
        it("should report an empty registry", async function () {
            expect(await registry.getChannels()).to.deep.equal([]);
            expect(await registry.getDeviceGroups()).to.deep.equal([]);
            expect(await registry.getAgents()).to.deep.equal([]);
            expect(await registry.getChannelCount()).to.equal(0);
            expect(await registry.getDeviceGroupCount()).to.equal(0);
            expect(await registry.getAgentCount()).to.equal(0);
        });

        it("should report false for unregistered addresses", async function () {
            expect(await registry.isRegisteredChannel(other.address)).to.equal(false);
            expect(await registry.isRegisteredDeviceGroup(other.address)).to.equal(false);
            expect(await registry.isRegisteredAgent(other.address)).to.equal(false);
        });
    });
});
