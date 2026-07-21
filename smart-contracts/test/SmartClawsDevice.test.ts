import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import type {
  SmartClawsDevice,
  SmartClawsChannel,
} from "../types/ethers-contracts/index.js";
import { ONE_MB, ROLES, loadFixture, deployDeviceFixture } from "./helpers/deploy.js";

// SmartClawsDevice is AccessControl-based: the group holds DEFAULT_ADMIN_ROLE,
// a per-device entity holds DEVICE_ADMIN_ROLE (admin of PUBLISHER/MASTER), and
// publishing is mediated through the device's role-gated entry points. Here the
// group is a MockDeviceGroup so the liveness gate (group.active()) is exercised.
// DEFAULT_ADMIN-as-actor scenarios (overrides, decommission) live in the group suite.
describe("SmartClawsDevice", function () {
  let ethers: any;
  let DeviceContract: any;
  let device: SmartClawsDevice;
  let incoming: SmartClawsChannel;
  let outgoing: SmartClawsChannel;
  let channelFactory: string;
  let mockGroup: any;
  let groupAddr: string;
  let deviceAdmin: any; // DEVICE_ADMIN
  let publisher: any;
  let master: any;

  beforeEach(async function () {
    const fx = await loadFixture(deployDeviceFixture);
    ethers = fx.ethers;
    DeviceContract = fx.DeviceContract;
    device = fx.device;
    incoming = fx.incoming;
    outgoing = fx.outgoing;
    channelFactory = fx.channelFactory;
    mockGroup = fx.mockGroup;
    groupAddr = fx.groupAddr;
    deviceAdmin = fx.deviceAdmin;
    publisher = fx.publisher;
    master = fx.master;
  });

  async function withGroupSigner(run: (signer: any) => Promise<void>) {
    await ethers.provider.send("hardhat_impersonateAccount", [groupAddr]);
    await ethers.provider.send("hardhat_setBalance", [groupAddr, "0x1000000000000000000"]);
    const asGroup = await ethers.getSigner(groupAddr);
    try {
      await run(asGroup);
    } finally {
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [groupAddr]);
    }
  }

  describe("Deployment", function () {
    it("should own two distinct channels with the right capacity", async function () {
      const deviceAddr = await device.getAddress();
      expect(await incoming.getAddress()).to.not.equal(await outgoing.getAddress());
      expect(await incoming.owner()).to.equal(deviceAddr);
      expect(await outgoing.owner()).to.equal(deviceAddr);
      expect(await incoming.maxCapacityBytes()).to.equal(ONE_MB);
      expect(await outgoing.maxCapacityBytes()).to.equal(ONE_MB);
    });

    it("should record the group, metadata and seed the two admin tiers", async function () {
      expect(await device.group()).to.equal(groupAddr);
      expect(await device.deviceId()).to.equal("device-1");
      expect(await device.createdAt()).to.be.gt(0);
      expect(await device.hasRole(ROLES.DEFAULT_ADMIN, groupAddr)).to.equal(true);
      expect(await device.hasRole(ROLES.DEVICE_ADMIN, deviceAdmin.address)).to.equal(true);
      expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(false);
      expect(await device.hasRole(ROLES.MASTER, master.address)).to.equal(false);
    });

    it("should wire the role-admin hierarchy", async function () {
      expect(await device.getRoleAdmin(ROLES.DEVICE_ADMIN)).to.equal(ROLES.DEFAULT_ADMIN);
      expect(await device.getRoleAdmin(ROLES.PUBLISHER)).to.equal(ROLES.DEVICE_ADMIN);
      expect(await device.getRoleAdmin(ROLES.MASTER)).to.equal(ROLES.DEVICE_ADMIN);
    });

    it("should reject zero group / deviceAdmin / registry", async function () {
      await expect(
        DeviceContract.deploy(ethersLib.ZeroAddress, deviceAdmin.address, deviceAdmin.address, channelFactory, ONE_MB, "device-1")
      ).to.be.revertedWithCustomError(device, "ZeroAddress");
      await expect(
        DeviceContract.deploy(groupAddr, ethersLib.ZeroAddress, deviceAdmin.address, channelFactory, ONE_MB, "device-1")
      ).to.be.revertedWithCustomError(device, "ZeroAddress");
      await expect(
        DeviceContract.deploy(groupAddr, deviceAdmin.address, ethersLib.ZeroAddress, channelFactory, ONE_MB, "device-1")
      ).to.be.revertedWithCustomError(device, "ZeroAddress");
    });
  });

  describe("Publishing", function () {
    it("should let a PUBLISHER publish telemetry to the outgoing channel", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("temp:24"))
      ).to.emit(outgoing, "MessagePublished");
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should reject telemetry from a non-publisher", async function () {
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });

    it("should propagate channel payload validation", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
      await expect(
        device.connect(publisher).publishTelemetry("0x")
      ).to.be.revertedWithCustomError(outgoing, "EmptyPayload");
    });

    it("should let a MASTER publish commands to the incoming channel", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.MASTER, master.address);
      await expect(
        device.connect(master).publishCommand(ethersLib.toUtf8Bytes("reboot"))
      ).to.emit(incoming, "MessagePublished");
      expect(await incoming.getMessageCount()).to.equal(1);
    });

    it("should reject commands from a non-master", async function () {
      await expect(
        device.connect(master).publishCommand(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });

    it("should reject publishing once the group is inactive", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
      await mockGroup.setActive(false);
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(device, "GroupInactive");
    });
  });

  describe("pause", function () {
    it("should let the DEVICE_ADMIN suspend and resume both channels", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);

      await expect(device.connect(deviceAdmin).pause())
        .to.emit(outgoing, "Paused")
        .and.to.emit(incoming, "Paused");
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(outgoing, "EnforcedPause");

      await device.connect(deviceAdmin).unpause();
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("temp:24"))
      ).to.emit(outgoing, "MessagePublished");
    });

    it("should reject pause from a non-DEVICE_ADMIN", async function () {
      await expect(
        device.connect(publisher).pause()
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });

    it("should reject unpause from a non-DEVICE_ADMIN", async function () {
      await device.connect(deviceAdmin).pause();
      await expect(
        device.connect(publisher).unpause()
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });
  });

  describe("prune", function () {
    it("should let DEVICE_ADMIN prune the outgoing channel after telemetry is published", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
      await device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("msg0"));
      await device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("msg1"));

      await device.connect(deviceAdmin).pruneOutgoing(1);
      expect(await outgoing.getMessageCount()).to.equal(1);
    });

    it("should let DEVICE_ADMIN prune the incoming channel after commands are published", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.MASTER, master.address);
      await device.connect(master).publishCommand(ethersLib.toUtf8Bytes("cmd0"));
      await device.connect(master).publishCommand(ethersLib.toUtf8Bytes("cmd1"));

      const pruned = await device.connect(deviceAdmin).pruneIncoming.staticCall(1);
      expect(pruned).to.equal(1);
      await device.connect(deviceAdmin).pruneIncoming(1);
      expect(await incoming.getMessageCount()).to.equal(1);
    });

    it("should reject prune from a non-DEVICE_ADMIN", async function () {
      await expect(
        device.connect(publisher).pruneOutgoing(1)
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Role administration", function () {
    it("should let the DEVICE_ADMIN grant PUBLISHER and MASTER", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
      await device.connect(deviceAdmin).grantRole(ROLES.MASTER, master.address);
      expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(true);
      expect(await device.hasRole(ROLES.MASTER, master.address)).to.equal(true);
    });

    it("should NOT let the DEVICE_ADMIN grant DEVICE_ADMIN", async function () {
      // admin-of != has-role: DEVICE_ADMIN is administered by DEFAULT_ADMIN (the group).
      await expect(
        device.connect(deviceAdmin).grantRole(ROLES.DEVICE_ADMIN, publisher.address)
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });
  });

  describe("deactivate", function () {
    it("should reject deactivate from a non-DEFAULT_ADMIN", async function () {
      await expect(
        device.connect(deviceAdmin).deactivate()
      ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
    });

    it("should let the group permanently disable both channels", async function () {
      await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);

      await withGroupSigner(async (asGroup) => {
        await device.connect(asGroup).deactivate();
      });

      expect(await incoming.writesEnabled()).to.equal(false);
      expect(await outgoing.writesEnabled()).to.equal(false);
      await expect(
        device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("x"))
      ).to.be.revertedWithCustomError(outgoing, "WritesAreDisabled");
    });
  });
});
