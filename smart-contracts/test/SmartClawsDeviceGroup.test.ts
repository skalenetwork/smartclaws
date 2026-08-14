import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import type { SmartClaws, SmartClawsDeviceGroup } from "../types/ethers-contracts/index.js";
import {
    ROLES,
    loadFixture,
    deployDeviceGroupFixture,
    registerDevice,
    registerEncryptedDevice,
} from "./helpers/deploy.js";

const CAPACITY = 1024;

describe("SmartClawsDeviceGroup", function () {
    let ethers: any;
    let registry: SmartClaws;
    let group: SmartClawsDeviceGroup;
    let owner: any; // group owner
    let deviceAdmin: any;
    let publisher: any;
    let other: any;

    beforeEach(async function () {
        const fx = await loadFixture(deployDeviceGroupFixture);
        ethers = fx.ethers;
        registry = fx.registry;
        group = fx.group;
        [owner, deviceAdmin, publisher, other] = fx.signers;
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
        it("should expose name, skills, registry, owner and active state", async function () {
            expect(await group.groupName()).to.equal("sensors");
            expect(await group.skills()).to.equal("skills.md");
            expect(await group.registry()).to.equal(await registry.getAddress());
            expect(await group.owner()).to.equal(owner.address);
            expect(await group.createdAt()).to.be.gt(0);
            expect(await group.active()).to.equal(true);
        });
    });

    describe("setSkills", function () {
        it("should let the owner update skills and emit SkillsUpdated", async function () {
            await expect(group.setSkills("skills-v2.md"))
                .to.emit(group, "SkillsUpdated")
                .withArgs("skills-v2.md");
            expect(await group.skills()).to.equal("skills-v2.md");
        });

        it("should reject a non-owner", async function () {
            await expect(group.connect(other).setSkills("nope.md")).to.be.revertedWithCustomError(
                group,
                "OwnableUnauthorizedAccount",
            );
        });
    });

    describe("registerDevice", function () {
        it("should register a device and track it", async function () {
            const tx = await group.registerDevice("dev-1", deviceAdmin.address, CAPACITY);
            const receipt = await tx.wait();
            await expect(tx)
                .to.emit(group, "DeviceRegistered")
                .withArgs(anyValue, "dev-1", false);

            expect(await group.getDeviceCount()).to.equal(1);
            const [deviceAddr] = await group.getDevices();
            expect(await group.isRegisteredDevice(deviceAddr)).to.equal(true);
        });

        it("should store device id and creation timestamp", async function () {
            const tx = await group.registerDevice("dev-timed", deviceAdmin.address, CAPACITY);
            const receipt = await tx.wait();
            const [deviceAddr] = await group.getDevices();
            const block = await ethers.provider.getBlock(receipt!.blockNumber);
            const device = await ethers.getContractAt("SmartClawsDevice", deviceAddr);

            expect(await device.deviceId()).to.equal("dev-timed");
            expect(await device.createdAt()).to.equal(block!.timestamp);
        });

        it("should pin the group as DEFAULT_ADMIN and seed the device admin", async function () {
            const groupAddr = await group.getAddress();
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            expect(await device.deviceId()).to.equal("dev-1");
            expect(await device.createdAt()).to.be.gt(0);
            expect(await device.hasRole(ROLES.DEFAULT_ADMIN, groupAddr)).to.equal(true);
            expect(await device.hasRole(ROLES.DEVICE_ADMIN, deviceAdmin.address)).to.equal(true);
            expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(false);
            expect(await device.hasRole(ROLES.MASTER, deviceAdmin.address)).to.equal(false);
        });

        it("should paginate devices", async function () {
            await registerDevice(ethers, group, owner, "d1", deviceAdmin.address, CAPACITY);
            await registerDevice(ethers, group, owner, "d2", deviceAdmin.address, CAPACITY);
            const all = await group.getDevices();

            expect(all.length).to.equal(2);
            expect(await group.getDevices(0, 1)).to.deep.equal([all[0]]);
            expect(await group.getDevices(1, 10)).to.deep.equal([all[1]]);
            expect(await group.getDevices(2, 10)).to.deep.equal([]);
        });

        it("should own both device channels", async function () {
            const { device, incoming, outgoing } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            const deviceAddr = await device.getAddress();
            expect(await incoming.owner()).to.equal(deviceAddr);
            expect(await outgoing.owner()).to.equal(deviceAddr);
        });

        it("should make the group the device admin when deviceAdmin is zero", async function () {
            const groupAddr = await group.getAddress();
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                ethersLib.ZeroAddress,
                CAPACITY,
            );
            expect(await device.hasRole(ROLES.DEFAULT_ADMIN, groupAddr)).to.equal(true);
            expect(await device.hasRole(ROLES.DEVICE_ADMIN, groupAddr)).to.equal(true);
        });

        it("should reject registration from a non-owner", async function () {
            await expect(
                group.connect(other).registerDevice("dev-1", deviceAdmin.address, CAPACITY),
            ).to.be.revertedWithCustomError(group, "OwnableUnauthorizedAccount");
        });

        it("should reject registration after the group is deactivated", async function () {
            await registry.connect(owner).unregisterDeviceGroup(await group.getAddress());
            await expect(
                group.registerDevice("dev-1", deviceAdmin.address, CAPACITY),
            ).to.be.revertedWithCustomError(group, "GroupInactive");
        });
    });

    describe("registerEncryptedDevice", function () {
        it("should register an encrypted device and track it separately from plain devices", async function () {
            const { device, incoming, outgoing } = await registerEncryptedDevice(
                ethers,
                group,
                owner,
                "enc-1",
                deviceAdmin.address,
                CAPACITY,
            );
            const deviceAddr = await device.getAddress();

            expect(await group.getEncryptedDeviceCount()).to.equal(1);
            expect(await group.getDeviceCount()).to.equal(0);
            expect(await group.getEncryptedDevices()).to.deep.equal([deviceAddr]);
            expect(await group.isRegisteredDevice(deviceAddr)).to.equal(true);
            expect(await incoming.isEncrypted()).to.equal(true);
            expect(await outgoing.isEncrypted()).to.equal(true);
        });

        it("should reject registration from a non-owner", async function () {
            await expect(
                group
                    .connect(other)
                    .registerEncryptedDevice("enc-1", deviceAdmin.address, CAPACITY),
            ).to.be.revertedWithCustomError(group, "OwnableUnauthorizedAccount");
        });

        it("should reject registration after the group is deactivated", async function () {
            await registry.connect(owner).unregisterDeviceGroup(await group.getAddress());
            await expect(
                group.registerEncryptedDevice("enc-1", deviceAdmin.address, CAPACITY),
            ).to.be.revertedWithCustomError(group, "GroupInactive");
        });
    });

    describe("Role passthroughs", function () {
        it("should let the owner manage roles when the group is the device admin", async function () {
            // deviceAdmin == 0 -> group holds DEVICE_ADMIN, so passthroughs work.
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                ethersLib.ZeroAddress,
                CAPACITY,
            );
            const deviceAddr = await device.getAddress();

            await group.grantPublisher(deviceAddr, publisher.address);
            expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(true);

            await group.grantMaster(deviceAddr, other.address);
            expect(await device.hasRole(ROLES.MASTER, other.address)).to.equal(true);

            await group.revokePublisher(deviceAddr, publisher.address);
            expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(false);

            await group.revokeMaster(deviceAddr, other.address);
            expect(await device.hasRole(ROLES.MASTER, other.address)).to.equal(false);

            await group.grantDeviceAdmin(deviceAddr, publisher.address);
            expect(await device.hasRole(ROLES.DEVICE_ADMIN, publisher.address)).to.equal(true);
            await group.revokeDeviceAdmin(deviceAddr, publisher.address);
            expect(await device.hasRole(ROLES.DEVICE_ADMIN, publisher.address)).to.equal(false);
        });

        it("should revert grantPublisher when an external entity is the device admin", async function () {
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            // Group is only DEFAULT_ADMIN here, not DEVICE_ADMIN, so it can't grant PUBLISHER.
            await expect(
                group.grantPublisher(await device.getAddress(), publisher.address),
            ).to.be.revertedWithCustomError(device, "AccessControlUnauthorizedAccount");
        });

        it("should let the owner override by re-appointing the device admin", async function () {
            const groupAddr = await group.getAddress();
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            const deviceAddr = await device.getAddress();

            await group.grantDeviceAdmin(deviceAddr, groupAddr); // self-appoint
            await group.grantPublisher(deviceAddr, publisher.address);
            expect(await device.hasRole(ROLES.PUBLISHER, publisher.address)).to.equal(true);
        });

        it("should reject passthroughs from a non-owner", async function () {
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            await expect(
                group.connect(other).grantDeviceAdmin(await device.getAddress(), other.address),
            ).to.be.revertedWithCustomError(group, "OwnableUnauthorizedAccount");
        });

        it("should reject passthroughs for an unregistered device", async function () {
            await expect(
                group.grantPublisher(other.address, publisher.address),
            ).to.be.revertedWithCustomError(group, "DeviceNotRegistered");
        });
    });

    describe("unregisterDevice", function () {
        it("should unregister, emit, and disable the device channels", async function () {
            const { device, incoming, outgoing } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            const deviceAddr = await device.getAddress();

            await expect(group.unregisterDevice(deviceAddr))
                .to.emit(group, "DeviceUnregistered")
                .withArgs(deviceAddr);

            expect(await group.isRegisteredDevice(deviceAddr)).to.equal(false);
            expect(await group.getDeviceCount()).to.equal(0);
            expect(await group.getDevices()).to.deep.equal([]);
            expect(await incoming.writesEnabled()).to.equal(false);
            expect(await outgoing.writesEnabled()).to.equal(false);
        });

        it("should reject an unknown device", async function () {
            await expect(group.unregisterDevice(other.address)).to.be.revertedWithCustomError(
                group,
                "DeviceNotRegistered",
            );
        });

        it("should reject from a non-owner", async function () {
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            await expect(
                group.connect(other).unregisterDevice(await device.getAddress()),
            ).to.be.revertedWithCustomError(group, "OwnableUnauthorizedAccount");
        });

        it("should only remove the encrypted device from the encrypted set, leaving plain devices untouched", async function () {
            const { device: plainDevice } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-plain",
                deviceAdmin.address,
                CAPACITY,
            );
            const { device: encDevice } = await registerEncryptedDevice(
                ethers,
                group,
                owner,
                "dev-enc",
                deviceAdmin.address,
                CAPACITY,
            );
            const plainAddr = await plainDevice.getAddress();
            const encAddr = await encDevice.getAddress();

            await expect(group.unregisterDevice(encAddr))
                .to.emit(group, "DeviceUnregistered")
                .withArgs(encAddr);

            expect(await group.isRegisteredDevice(encAddr)).to.equal(false);
            expect(await group.getEncryptedDeviceCount()).to.equal(0);
            expect(await group.isRegisteredDevice(plainAddr)).to.equal(true);
            expect(await group.getDevices()).to.deep.equal([plainAddr]);
        });
    });

    describe("deactivate", function () {
        it("should reject a direct call (registry only)", async function () {
            await expect(group.deactivate()).to.be.revertedWithCustomError(group, "Unauthorized");
        });

        it("should deactivate via the registry and emit GroupDeactivated", async function () {
            const groupAddr = await group.getAddress();
            await expect(registry.connect(owner).unregisterDeviceGroup(groupAddr))
                .to.emit(group, "GroupDeactivated")
                .withArgs(groupAddr);
            expect(await group.active()).to.equal(false);
        });

        it("should treat repeated registry deactivation as a no-op", async function () {
            const groupAddr = await group.getAddress();
            await withRegistrySigner(async (asRegistry) => {
                await expect(group.connect(asRegistry).deactivate())
                    .to.emit(group, "GroupDeactivated")
                    .withArgs(groupAddr);
                await expect(group.connect(asRegistry).deactivate()).to.not.emit(
                    group,
                    "GroupDeactivated",
                );
            });
            expect(await group.active()).to.equal(false);
        });

        it("should stop registered devices from publishing once the group is deactivated", async function () {
            const { device } = await registerDevice(
                ethers,
                group,
                owner,
                "dev-1",
                deviceAdmin.address,
                CAPACITY,
            );
            await device.connect(deviceAdmin).grantRole(ROLES.PUBLISHER, publisher.address);
            await device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("ok"));

            await registry.connect(owner).unregisterDeviceGroup(await group.getAddress());

            await expect(
                device.connect(publisher).publishTelemetry(ethersLib.toUtf8Bytes("no")),
            ).to.be.revertedWithCustomError(device, "GroupInactive");
        });
    });
});
