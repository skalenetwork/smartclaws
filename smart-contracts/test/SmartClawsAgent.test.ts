import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import type {
  SmartClaws,
  SmartClawsAgent,
  SmartClawsChannel,
} from "../types/ethers-contracts/index.js";
import { AGENT_ROLES, ONE_MB, loadFixture, deployAgentFixture } from "./helpers/deploy.js";

describe("SmartClawsAgent", function () {
  let ethers: any;
  let registry: SmartClaws;
  let agentFactoryAddr: string;
  let channelFactoryAddr: string;
  let agent: SmartClawsAgent;
  let incoming: SmartClawsChannel;
  let outgoing: SmartClawsChannel;
  let owner: any;
  let sender: any;
  let other: any;
  let newOwner: any;

  beforeEach(async function () {
    const fx = await loadFixture(deployAgentFixture);
    ethers = fx.ethers;
    registry = fx.registry;
    agentFactoryAddr = fx.agentFactory;
    channelFactoryAddr = fx.channelFactory;
    agent = fx.agent;
    incoming = fx.incoming;
    outgoing = fx.outgoing;
    [owner, sender, other, newOwner] = fx.signers;
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

  describe("Publishing", function () {
    it("should publish to the outgoing channel and bump the count", async function () {
      const payload = ethersLib.toUtf8Bytes("telemetry");
      await expect(agent.publishOutbound(payload))
        .to.emit(agent, "AgentOutboundPublished")
        .withArgs(await agent.getAddress(), await outgoing.getAddress(), owner.address)
        .and.to.emit(outgoing, "MessagePublished");
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should reject outgoing publishing from a non-publisher", async function () {
      await expect(
        agent.connect(other).publishOutbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "AccessControlUnauthorizedAccount");
    });

    it("should let a SENDER publish to the incoming channel", async function () {
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);

      await expect(agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("work")))
        .to.emit(agent, "AgentInboundPublished")
        .withArgs(await agent.getAddress(), await incoming.getAddress(), sender.address)
        .and.to.emit(incoming, "MessagePublished");
      expect(await incoming.getMessageCount()).to.equal(1);
    });

    it("should reject incoming publishing from a non-sender", async function () {
      await expect(
        agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "AccessControlUnauthorizedAccount");
    });

    it("should reject publishing after deactivation", async function () {
      await agent.deactivate();
      await expect(
        agent.publishOutbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "AlreadyInactive");
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);
      await expect(
        agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(agent, "AlreadyInactive");
    });
  });

  // Reads now go directly against the SmartClawsChannel contract (the agent no
  // longer re-wraps channel reads); this mirrors how the SDK consumes messages.
  describe("Channel reads", function () {
    it("should expose outgoing reads after a publish", async function () {
      await agent.publishOutbound(ethersLib.toUtf8Bytes("hello"));

      expect(ethersLib.toUtf8String(await outgoing.readMessage(0))).to.equal("hello");
      expect(await outgoing.getLatestMessageOffset()).to.equal(0);
      expect(await outgoing.getOldestMessageOffset()).to.equal(0);
      expect(await outgoing.getMessageCount()).to.equal(1);

      const [payloads, offsets] = await outgoing.readMessages(0, 1);
      expect(ethersLib.toUtf8String(payloads[0])).to.equal("hello");
      expect(offsets[0]).to.equal(0);
    });

    it("should expose incoming reads after sender publishing", async function () {
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);
      await agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("hello-agent"));

      expect(ethersLib.toUtf8String(await incoming.readMessage(0))).to.equal("hello-agent");
      expect(await incoming.getLatestMessageOffset()).to.equal(0);
      expect(await incoming.getOldestMessageOffset()).to.equal(0);
      expect(await incoming.getMessageCount()).to.equal(1);
    });
  });

  describe("pause", function () {
    it("should suspend publishing on both channels and resume after unpause", async function () {
      await expect(agent.pause()).to.emit(outgoing, "Paused").and.to.emit(incoming, "Paused");
      expect(await outgoing.paused()).to.equal(true);
      expect(await incoming.paused()).to.equal(true);

      await expect(
        agent.publishOutbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(outgoing, "EnforcedPause");
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);
      await expect(
        agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(incoming, "EnforcedPause");

      await agent.unpause();
      expect(await outgoing.paused()).to.equal(false);
      await expect(agent.publishOutbound(ethersLib.toUtf8Bytes("x"))).to.emit(
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

    it("should let an agent admin suspend and resume both channels", async function () {
      await agent.grantRole(AGENT_ROLES.AGENT_ADMIN, sender.address);

      await expect(agent.connect(sender).pause())
        .to.emit(outgoing, "Paused")
        .and.to.emit(incoming, "Paused");
      await expect(agent.connect(sender).unpause())
        .to.emit(outgoing, "Unpaused")
        .and.to.emit(incoming, "Unpaused");
    });
  });

  describe("prune", function () {
    it("should let the owner prune the outgoing channel and return pruned count", async function () {
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg0"));
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg1"));
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg2"));

      const pruned = await agent.pruneOutgoing.staticCall(2);
      expect(pruned).to.equal(2);

      await agent.pruneOutgoing(2);
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should let the owner prune the incoming channel", async function () {
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);
      await agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("msg0"));
      await agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("msg1"));

      const pruned = await agent.pruneIncoming.staticCall(1);
      expect(pruned).to.equal(1);
      await agent.pruneIncoming(1);
      expect(await incoming.getMessageCount()).to.equal(1);
    });

    it("should let the registry prune agent-owned channels", async function () {
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg0"));
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg1"));

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

    it("should let an agent admin prune channels", async function () {
      await agent.grantRole(AGENT_ROLES.AGENT_ADMIN, sender.address);
      await agent.publishOutbound(ethersLib.toUtf8Bytes("msg0"));

      const pruned = await agent.connect(sender).pruneOutgoing.staticCall(1);
      expect(pruned).to.equal(1);
      await agent.connect(sender).pruneOutgoing(1);
      expect(await outgoing.getMessageCount()).to.equal(0);
    });
  });

  describe("Role administration", function () {
    it("should let the agent admin grant PUBLISHER and SENDER", async function () {
      await agent.grantRole(AGENT_ROLES.PUBLISHER, sender.address);
      await agent.grantRole(AGENT_ROLES.SENDER, sender.address);
      expect(await agent.hasRole(AGENT_ROLES.PUBLISHER, sender.address)).to.equal(true);
      expect(await agent.hasRole(AGENT_ROLES.SENDER, sender.address)).to.equal(true);

      await expect(agent.connect(sender).publishOutbound(ethersLib.toUtf8Bytes("out"))).to.emit(
        outgoing,
        "MessagePublished"
      );
      await expect(agent.connect(sender).publishInbound(ethersLib.toUtf8Bytes("in"))).to.emit(
        incoming,
        "MessagePublished"
      );
    });

    it("should reject role grants from a non-admin", async function () {
      await expect(
        agent.connect(sender).grantRole(AGENT_ROLES.SENDER, other.address)
      ).to.be.revertedWithCustomError(agent, "AccessControlUnauthorizedAccount");
    });

    it("should move owner-held admin and publisher roles during ownership transfer", async function () {
      await agent.transferOwnership(newOwner.address);
      await agent.connect(newOwner).acceptOwnership();

      expect(await agent.owner()).to.equal(newOwner.address);
      expect(await agent.hasRole(AGENT_ROLES.DEFAULT_ADMIN, owner.address)).to.equal(false);
      expect(await agent.hasRole(AGENT_ROLES.AGENT_ADMIN, owner.address)).to.equal(false);
      expect(await agent.hasRole(AGENT_ROLES.PUBLISHER, owner.address)).to.equal(false);
      expect(await agent.hasRole(AGENT_ROLES.DEFAULT_ADMIN, newOwner.address)).to.equal(true);
      expect(await agent.hasRole(AGENT_ROLES.AGENT_ADMIN, newOwner.address)).to.equal(true);
      expect(await agent.hasRole(AGENT_ROLES.PUBLISHER, newOwner.address)).to.equal(true);

      await expect(agent.publishOutbound(ethersLib.toUtf8Bytes("old"))).to.be.revertedWithCustomError(
        agent,
        "AccessControlUnauthorizedAccount"
      );
      await expect(
        agent.connect(newOwner).publishOutbound(ethersLib.toUtf8Bytes("new"))
      ).to.emit(outgoing, "MessagePublished");
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
