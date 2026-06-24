import hre from "hardhat";
import { id, ZeroHash } from "ethers";
import type {
  SmartClaws,
  SmartClawsChannel,
  SmartClawsDeviceGroup,
  SmartClawsAgent,
  SmartClawsDevice,
} from "../../types/ethers-contracts/index.js";

export const ONE_MB = 1024 * 1024;

/** AccessControl role identifiers used by SmartClawsDevice (see DeviceRoles.sol). */
export const ROLES = {
  DEFAULT_ADMIN: ZeroHash,
  DEVICE_ADMIN: id("DEVICE_ADMIN_ROLE"),
  PUBLISHER: id("PUBLISHER_ROLE"),
  MASTER: id("MASTER_ROLE"),
};

// One shared connection for the whole run. getOrCreate() returns the cached
// connection on repeat calls, which is what lets loadFixture snapshots persist
// across test files. (Replaces the deprecated network.connect().)
let connectionPromise: Promise<any> | undefined;

export function getConnection(): Promise<any> {
  if (!connectionPromise) {
    connectionPromise = hre.network.getOrCreate();
  }
  return connectionPromise;
}

/** Snapshot-backed fixture loader bound to the shared connection. */
export async function loadFixture<T>(fixture: () => Promise<T>): Promise<T> {
  const { networkHelpers } = await getConnection();
  return networkHelpers.loadFixture(fixture);
}

/**
 * Generic event-argument extractor. Parses the receipt logs for `eventName` and
 * returns the named (or positional) argument — a drop-in generalization of the
 * old per-test `getChannelFromReceipt` helper.
 */
export function getAddressFromReceipt(
  contract: { interface: any },
  receipt: any,
  eventName: string,
  argName: string | number
): string {
  const event = receipt?.logs.find((log: any) => {
    try {
      return (
        contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        })?.name === eventName
      );
    } catch {
      return false;
    }
  });
  const parsed = contract.interface.parseLog({
    topics: event!.topics as string[],
    data: event!.data,
  });
  return parsed?.args[argName];
}

// --- Low-level deploy/orchestration helpers (used by fixtures and in-test) ---

export interface DeployedSystem {
  registry: SmartClaws;
  channelFactory: string;
  deviceFactory: string;
  deviceGroupFactory: string;
  agentFactory: string;
}

/**
 * Deploys the four factories and a SmartClaws registry wired to them.
 * Single source of truth for protocol deployment.
 */
export async function deploySystem(ethers: any): Promise<DeployedSystem> {
  const deployOne = async (name: string): Promise<string> => {
    const factory = await ethers.getContractFactory(name);
    const instance = await factory.deploy();
    await instance.waitForDeployment();
    return instance.getAddress();
  };

  const channelFactory = await deployOne("ChannelFactory");
  const deviceFactory = await deployOne("DeviceFactory");
  const deviceGroupFactory = await deployOne("DeviceGroupFactory");
  const agentFactory = await deployOne("AgentFactory");

  const SmartClawsFactory = await ethers.getContractFactory("SmartClaws");
  const registry: SmartClaws = await SmartClawsFactory.deploy(
    channelFactory,
    deviceFactory,
    deviceGroupFactory,
    agentFactory
  );
  await registry.waitForDeployment();

  return { registry, channelFactory, deviceFactory, deviceGroupFactory, agentFactory };
}

/** Creates a channel through the registry and returns its contract instance. */
export async function createChannel(
  ethers: any,
  registry: SmartClaws,
  ownerAddr: string,
  capacity: number | bigint
): Promise<SmartClawsChannel> {
  const tx = await registry.createChannel(ownerAddr, capacity);
  const receipt = await tx.wait();
  const address = getAddressFromReceipt(registry, receipt, "ChannelCreated", "channel");
  return ethers.getContractAt("SmartClawsChannel", address);
}

/** Registers a device group through the registry and returns its instance. */
export async function createDeviceGroup(
  ethers: any,
  registry: SmartClaws,
  signer: any,
  name = "sensors",
  skills = "skills.md"
): Promise<SmartClawsDeviceGroup> {
  const tx = await registry.connect(signer).registerDeviceGroup(name, skills);
  const receipt = await tx.wait();
  const address = getAddressFromReceipt(registry, receipt, "DeviceGroupRegistered", "deviceGroup");
  return ethers.getContractAt("SmartClawsDeviceGroup", address);
}

/** Registers an agent through the registry and returns its instance. */
export async function createAgent(
  ethers: any,
  registry: SmartClaws,
  signer: any,
  capacity: number | bigint,
  agentId = "agent-1",
  metadata = "metadata"
): Promise<SmartClawsAgent> {
  const tx = await registry.connect(signer).registerAgent(agentId, metadata, capacity);
  const receipt = await tx.wait();
  const address = getAddressFromReceipt(registry, receipt, "AgentRegistered", "agent");
  return ethers.getContractAt("SmartClawsAgent", address);
}

export interface RegisteredDevice {
  device: SmartClawsDevice;
  incoming: SmartClawsChannel;
  outgoing: SmartClawsChannel;
}

/**
 * Registers a device in a group and returns the device plus its two channels,
 * resolved from the device's own getters (the device owns its channels).
 */
export async function registerDevice(
  ethers: any,
  group: SmartClawsDeviceGroup,
  signer: any,
  deviceId: string,
  deviceAdmin: string,
  capacity: number | bigint
): Promise<RegisteredDevice> {
  const tx = await group.connect(signer).registerDevice(deviceId, deviceAdmin, capacity);
  const receipt = await tx.wait();
  const deviceAddr = getAddressFromReceipt(group, receipt, "DeviceRegistered", "device");
  const device = await ethers.getContractAt("SmartClawsDevice", deviceAddr);

  return {
    device,
    incoming: await ethers.getContractAt(
      "SmartClawsChannel",
      await device.getIncomingMessagesChannel()
    ),
    outgoing: await ethers.getContractAt(
      "SmartClawsChannel",
      await device.getOutgoingMessagesChannel()
    ),
  };
}

// --- Fixtures (pass these to loadFixture) ---
// Each is a stable named function so loadFixture can snapshot/restore it.

export async function deploySystemFixture() {
  const { ethers } = await getConnection();
  const signers = await ethers.getSigners();
  const system = await deploySystem(ethers);
  return { ethers, signers, ...system };
}

export async function deployChannelFixture() {
  const base = await deploySystemFixture();
  const channel = await createChannel(
    base.ethers,
    base.registry,
    base.signers[0].address,
    ONE_MB
  );
  return { ...base, channel };
}

export async function deployDeviceGroupFixture() {
  const base = await deploySystemFixture();
  const group = await createDeviceGroup(base.ethers, base.registry, base.signers[0]);
  return { ...base, group };
}

export async function deployAgentFixture() {
  const base = await deploySystemFixture();
  const agent = await createAgent(base.ethers, base.registry, base.signers[0], ONE_MB);
  const incoming = await base.ethers.getContractAt(
    "SmartClawsChannel",
    await agent.getIncomingMessagesChannel()
  );
  const outgoing = await base.ethers.getContractAt(
    "SmartClawsChannel",
    await agent.getOutgoingMessagesChannel()
  );
  return { ...base, agent, incoming, outgoing };
}

export async function deployDeviceFixture() {
  const { ethers } = await getConnection();
  const signers = await ethers.getSigners();
  // EOAs for the device-admin / publisher / master roles. The managing group is
  // a MockDeviceGroup contract so the device's liveness gate (group.active()) and
  // DEFAULT_ADMIN holder resolve against real code. registry is a dummy address.
  const [deviceAdmin, publisher, master, other] = signers;

  const mockGroup = await (await ethers.getContractFactory("MockDeviceGroup")).deploy();
  await mockGroup.waitForDeployment();
  const groupAddr = await mockGroup.getAddress();

  const ChannelFactory = await ethers.getContractFactory("ChannelFactory");
  const channelFactory = await ChannelFactory.deploy();
  await channelFactory.waitForDeployment();
  const channelFactoryAddr = await channelFactory.getAddress();

  const DeviceContract = await ethers.getContractFactory("SmartClawsDevice");
  const device: SmartClawsDevice = await DeviceContract.deploy(
    groupAddr,
    deviceAdmin.address,
    deviceAdmin.address, // dummy registry (only needs to be non-zero)
    channelFactoryAddr,
    ONE_MB,
    "device-1"
  );
  await device.waitForDeployment();

  const incoming = await ethers.getContractAt(
    "SmartClawsChannel",
    await device.getIncomingMessagesChannel()
  );
  const outgoing = await ethers.getContractAt(
    "SmartClawsChannel",
    await device.getOutgoingMessagesChannel()
  );

  return {
    ethers,
    signers,
    DeviceContract,
    channelFactory: channelFactoryAddr,
    device,
    incoming,
    outgoing,
    mockGroup,
    groupAddr,
    deviceAdmin,
    publisher,
    master,
    other,
  };
}
