import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import type {
  SmartClaws,
  SmartClawsAgent,
  SmartClawsChannel,
} from "../types/ethers-contracts/index.js";
import { ONE_MB, loadFixture, deployAgentFixture } from "./helpers/deploy.js";

describe("SmartClawsAgent", function () {
  let ethers: any;
  let registry: SmartClaws;
  let agentFactoryAddr: string;
  let channelFactoryAddr: string;
  let agent: SmartClawsAgent;
  let incoming: SmartClawsChannel;
  let outgoing: SmartClawsChannel;
  let owner: any;
  let other: any;

  beforeEach(async function () {
    const fx = await loadFixture(deployAgentFixture);
    ethers = fx.ethers;
    registry = fx.registry;
    agentFactoryAddr = fx.agentFactory;
    channelFactoryAddr = fx.channelFactory;
    agent = fx.agent;
    incoming = fx.incoming;
    outgoing = fx.outgoing;
    [owner, other] = fx.signers;
  });

  async function withRegistrySigner(run: (signer: any) => Promise<void>) {
    const registryAddr = await registry.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [registryAddr]);
    await ethers.provider.send("hardhat_setBalance", [registryAddr, "0x1000000000000000000"]);
    const asRegistry = await ethers.getSigner(registryAddr);
    try {
      await run(asRegistry);
    } finally {
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [registryAddr]);
    }
  }

  describe("Deployment", function () {
    it("should expose registry, active state and owner", async function () {
      expect(await agent.registry()).to.equal(await registry.getAddress());
      expect(await agent.active()).to.equal(true);
      expect(await agent.owner()).to.equal(owner.address);
    });

    it("should provision two distinct agent-owned channels", async function () {
      const agentAddr = await agent.getAddress();
      expect(await incoming.getAddress()).to.not.equal(await outgoing.getAddress());
      expect(await incoming.owner()).to.equal(agentAddr);
      expect(await outgoing.owner()).to.equal(agentAddr);
      expect(await incoming.maxCapacityBytes()).to.equal(ONE_MB);
      expect(await outgoing.maxCapacityBytes()).to.equal(ONE_MB);
    });

    it("should expose its agentId and metadata", async function () {
      expect(await agent.agentId()).to.equal("agent-1");
      expect(await agent.metadata()).to.equal("metadata");
      expect(await agent.createdAt()).to.be.gt(0);
    });

    it("should reject a zero registry at construction", async function () {
      const factory = await ethers.getContractAt("AgentFactory", agentFactoryAddr);
      await expect(
        factory.createAgent(
          owner.address,
          ONE_MB,
          ethersLib.ZeroAddress,
          channelFactoryAddr,
          "agent-1",
          "metadata"
        )
      ).to.be.revertedWithCustomError(agent, "InvalidRegistryAddress");
    });

    it("should reject a zero owner at construction", async function () {
      const factory = await ethers.getContractAt("AgentFactory", agentFactoryAddr);
      await expect(
        factory.createAgent(
          ethersLib.ZeroAddress,
          ONE_MB,
          await registry.getAddress(),
          channelFactoryAddr,
          "agent-1",
          "metadata"
        )
      ).to.be.revertedWithCustomError(agent, "OwnableInvalidOwner");
    });
  });

  describe("publishMessage", function () {
    it("should publish to the outgoing channel and bump the count", async function () {
      const payload = ethersLib.toUtf8Bytes("telemetry");
      await expect(agent.publishMessage(payload)).to.emit(outgoing, "MessagePublished");
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should reject a non-owner", async function () {
      await expect(
        agent.connect(other).publishMessage(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "OwnableUnauthorizedAccount");
    });

    it("should reject publishing after deactivation", async function () {
      await agent.deactivate();
      await expect(
        agent.publishMessage(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "AlreadyInactive");
    });
  });

  // Reads now go directly against the SmartClawsChannel contract (the agent no
  // longer re-wraps channel reads); this mirrors how the SDK consumes messages.
  describe("Channel reads", function () {
    it("should expose outgoing reads after a publish", async function () {
      await agent.publishMessage(ethersLib.toUtf8Bytes("hello"));

      expect(ethersLib.toUtf8String(await outgoing.readMessage(0))).to.equal("hello");
      expect(await outgoing.getLatestMessageOffset()).to.equal(0);
      expect(await outgoing.getOldestMessageOffset()).to.equal(0);
      expect(await outgoing.getMessageCount()).to.equal(1);

      const [payloads, offsets] = await outgoing.readMessages(0, 1);
      expect(ethersLib.toUtf8String(payloads[0])).to.equal("hello");
      expect(offsets[0]).to.equal(0);
    });

    it("should report an empty incoming channel", async function () {
      expect(await incoming.getMessageCount()).to.equal(0);
      await expect(incoming.readMessage(0)).to.be.revertedWithCustomError(
        incoming,
        "ChannelEmpty"
      );
    });
  });

  describe("pause", function () {
    it("should suspend publishing on both channels and resume after unpause", async function () {
      await expect(agent.pause()).to.emit(outgoing, "Paused").and.to.emit(incoming, "Paused");
      expect(await outgoing.paused()).to.equal(true);
      expect(await incoming.paused()).to.equal(true);

      await expect(
        agent.publishMessage(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(outgoing, "EnforcedPause");

      await agent.unpause();
      expect(await outgoing.paused()).to.equal(false);
      await expect(agent.publishMessage(ethersLib.toUtf8Bytes("x"))).to.emit(
        outgoing,
        "MessagePublished"
      );
    });

    it("should leave `active` untouched (pause and deactivate are independent)", async function () {
      await agent.pause();
      expect(await agent.active()).to.equal(true);
    });

    it("should let the registry suspend and resume both channels", async function () {
      await withRegistrySigner(async (asRegistry) => {
        await expect(agent.connect(asRegistry).pause())
          .to.emit(outgoing, "Paused")
          .and.to.emit(incoming, "Paused");
        await expect(agent.connect(asRegistry).unpause())
          .to.emit(outgoing, "Unpaused")
          .and.to.emit(incoming, "Unpaused");
      });
    });

    it("should reject pause from a non-owner, non-registry caller", async function () {
      await expect(
        agent.connect(other).pause()
      ).to.be.revertedWithCustomError(agent, "Unauthorized");
    });
  });

  describe("prune", function () {
    it("should let the owner prune the outgoing channel and return pruned count", async function () {
      await agent.publishMessage(ethersLib.toUtf8Bytes("msg0"));
      await agent.publishMessage(ethersLib.toUtf8Bytes("msg1"));
      await agent.publishMessage(ethersLib.toUtf8Bytes("msg2"));

      const pruned = await agent.pruneOutgoing.staticCall(2);
      expect(pruned).to.equal(2);

      await agent.pruneOutgoing(2);
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should let the owner prune the incoming channel", async function () {
      // Incoming is owned by the agent — publish via channel directly (owner = agent contract).
      // We can't publish to incoming through the agent API yet (notify TODO), so
      // verify the function exists, fires, and returns 0 on an empty channel.
      const pruned = await agent.pruneIncoming.staticCall(5);
      expect(pruned).to.equal(0);
    });

    it("should let the registry prune agent-owned channels", async function () {
      await agent.publishMessage(ethersLib.toUtf8Bytes("msg0"));
      await agent.publishMessage(ethersLib.toUtf8Bytes("msg1"));

      await withRegistrySigner(async (asRegistry) => {
        const pruned = await agent.connect(asRegistry).pruneOutgoing.staticCall(1);
        expect(pruned).to.equal(1);
        await agent.connect(asRegistry).pruneOutgoing(1);
      });

      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should reject prune from a non-owner, non-registry caller", async function () {
      await expect(
        agent.connect(other).pruneOutgoing(1)
      ).to.be.revertedWithCustomError(agent, "Unauthorized");
    });
  });

  describe("deactivate", function () {
    it("should allow the owner to self-deactivate", async function () {
      const agentAddr = await agent.getAddress();
      await expect(agent.deactivate())
        .to.emit(agent, "AgentDeactivated")
        .withArgs(agentAddr);
      expect(await agent.active()).to.equal(false);
    });

    it("should deactivate and disable both channels' writes via the registry", async function () {
      const agentAddr = await agent.getAddress();
      await expect(registry.connect(owner).unregisterAgent(agentAddr))
        .to.emit(agent, "AgentDeactivated")
        .withArgs(agentAddr);

      expect(await agent.active()).to.equal(false);
      expect(await outgoing.writesEnabled()).to.equal(false);
      expect(await incoming.writesEnabled()).to.equal(false);
    });

    it("should reject a non-owner, non-registry caller", async function () {
      await expect(
        agent.connect(other).deactivate()
      ).to.be.revertedWithCustomError(agent, "Unauthorized");
    });

    it("should treat a second deactivation as a no-op", async function () {
      await expect(agent.deactivate()).to.emit(agent, "AgentDeactivated");
      await expect(agent.deactivate()).to.not.emit(agent, "AgentDeactivated");
      expect(await agent.active()).to.equal(false);
    });

    it("should still unregister after the owner self-deactivates", async function () {
      const agentAddr = await agent.getAddress();
      await agent.deactivate();

      await expect(registry.connect(owner).unregisterAgent(agentAddr))
        .to.emit(registry, "AgentUnregistered")
        .withArgs(agentAddr);

      expect(await registry.isRegisteredAgent(agentAddr)).to.equal(false);
      expect(await outgoing.writesEnabled()).to.equal(false);
      expect(await incoming.writesEnabled()).to.equal(false);
    });
  });
});
