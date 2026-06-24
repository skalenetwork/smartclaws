import type {
  AgentFile,
  Config,
  DeviceFile,
  EntityCapabilities,
  GroupFile,
  SmartClawsMode,
  WalletFile,
} from "@smartclaws/core/types";
import {
  type Address,
  decodeEventLog,
  getAddress,
  isAddress,
  keccak256,
  toHex,
  zeroHash,
} from "viem";
import { listAgents, saveAgent } from "../agent.js";
import {
  getAgentContract,
  getClients,
  getDeviceContract,
  getDeviceGroupContract,
  getDeviceGroupReadContract,
  getDeviceWriteContract,
  getRegistryContract,
  getRegistryReadContract,
} from "../contracts.js";
import { listDevices, saveDevice } from "../device.js";
import { SmartClawsError } from "../errors.js";
import { listGroups, saveGroup } from "../group.js";

const DISCOVERY_PAGE_SIZE = 100n;
const DEVICE_ADMIN_ROLE = keccak256(toHex("DEVICE_ADMIN_ROLE"));
const PUBLISHER_ROLE = keccak256(toHex("PUBLISHER_ROLE"));
const MASTER_ROLE = keccak256(toHex("MASTER_ROLE"));

type NamedRecord = { address: string; name: string };
export type DevicePermissionRole = "publisher" | "master";

function normalizeAddress(address: string): Address {
  return getAddress(address) as Address;
}

function sameAddress(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

async function readPages(
  count: bigint,
  readPage: (offset: bigint, limit: bigint) => Promise<readonly Address[]>,
): Promise<Address[]> {
  const addresses: Address[] = [];
  for (let offset = 0n; offset < count; offset += DISCOVERY_PAGE_SIZE) {
    const remaining = count - offset;
    const limit = remaining < DISCOVERY_PAGE_SIZE ? remaining : DISCOVERY_PAGE_SIZE;
    addresses.push(...(await readPage(offset, limit)));
  }
  return addresses;
}

function requireUnique<T extends NamedRecord>(matches: T[], kind: string, query: string): T {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new SmartClawsError("ENTITY_NOT_FOUND", `${kind} '${query}' was not found.`, {
      kind,
      query,
    });
  }
  throw new SmartClawsError(
    "AMBIGUOUS_ENTITY",
    `${kind} name '${query}' matched multiple records.`,
    {
      kind,
      query,
      matches,
    },
  );
}

export async function hydrateDevice(
  deviceAddress: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<DeviceFile> {
  const address = normalizeAddress(deviceAddress);
  const device = getDeviceContract(address, config);

  const [name, groupAddress, createdAt, incomingChannel, outgoingChannel] = await Promise.all([
    device.read.deviceId() as Promise<string>,
    device.read.group() as Promise<Address>,
    device.read.createdAt() as Promise<bigint>,
    device.read.getIncomingMessagesChannel() as Promise<Address>,
    device.read.getOutgoingMessagesChannel() as Promise<Address>,
  ]);

  const capabilities: EntityCapabilities = {};
  if (wallet) {
    const account = normalizeAddress(wallet.address);
    const [isDeviceAdmin, isPublisher, isMaster] = await Promise.all([
      device.read.hasRole([DEVICE_ADMIN_ROLE, account]) as Promise<boolean>,
      device.read.hasRole([PUBLISHER_ROLE, account]) as Promise<boolean>,
      device.read.hasRole([MASTER_ROLE, account]) as Promise<boolean>,
    ]);
    capabilities.isDeviceAdmin = isDeviceAdmin;
    capabilities.isPublisher = isPublisher;
    capabilities.isMaster = isMaster;
  }

  const record: DeviceFile = {
    name,
    deviceContract: address,
    groupAddress,
    createdAt: Number(createdAt),
    incomingChannel,
    outgoingChannel,
    capabilities,
  };
  saveDevice(record, homeDir);
  return record;
}

export async function hydrateGroup(
  groupAddress: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<GroupFile> {
  const address = normalizeAddress(groupAddress);
  const group = getDeviceGroupReadContract(address, config);

  const [name, skills, createdAt, owner, deviceCount] = await Promise.all([
    group.read.groupName() as Promise<string>,
    group.read.skills() as Promise<string>,
    group.read.createdAt() as Promise<bigint>,
    group.read.owner() as Promise<Address>,
    group.read.getDeviceCount() as Promise<bigint>,
  ]);
  const deviceAddresses = await readPages(
    deviceCount,
    (offset, limit) => group.read.getDevices([offset, limit]) as Promise<readonly Address[]>,
  );

  const capabilities: EntityCapabilities = {};
  if (wallet) capabilities.isGroupOwner = sameAddress(owner, wallet.address);

  const record: GroupFile = {
    name,
    groupAddress: address,
    skills,
    createdAt: Number(createdAt),
    owner,
    deviceCount: Number(deviceCount),
    devices: [...deviceAddresses],
    capabilities,
  };
  saveGroup(record, homeDir);
  return record;
}

export async function hydrateAgent(
  agentAddress: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<AgentFile> {
  const address = normalizeAddress(agentAddress);
  const agent = getAgentContract(address, config);

  const [agentId, metadata, createdAt, owner, incomingChannel, outgoingChannel] = await Promise.all(
    [
      agent.read.agentId() as Promise<string>,
      agent.read.metadata() as Promise<string>,
      agent.read.createdAt() as Promise<bigint>,
      agent.read.owner() as Promise<Address>,
      agent.read.getIncomingMessagesChannel() as Promise<Address>,
      agent.read.getOutgoingMessagesChannel() as Promise<Address>,
    ],
  );

  const capabilities: EntityCapabilities = {};
  if (wallet) capabilities.isAgentOwner = sameAddress(owner, wallet.address);

  const record: AgentFile = {
    name: agentId,
    agentId,
    metadata,
    agentContract: address,
    incomingChannel,
    outgoingChannel,
    owner,
    createdAt: Number(createdAt),
    capabilities,
  };
  saveAgent(record, homeDir);
  return record;
}

export async function discoverGroups(
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<GroupFile[]> {
  const registry = getRegistryReadContract(config);
  const count = (await registry.read.getDeviceGroupCount()) as bigint;
  const addresses = await readPages(
    count,
    (offset, limit) =>
      registry.read.getDeviceGroups([offset, limit]) as Promise<readonly Address[]>,
  );
  return Promise.all(addresses.map((address) => hydrateGroup(address, config, wallet, homeDir)));
}

export async function discoverDevices(
  config: Config,
  groupAddress: string,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<DeviceFile[]> {
  const group = getDeviceGroupReadContract(normalizeAddress(groupAddress), config);
  const count = (await group.read.getDeviceCount()) as bigint;
  const addresses = await readPages(
    count,
    (offset, limit) => group.read.getDevices([offset, limit]) as Promise<readonly Address[]>,
  );
  return Promise.all(addresses.map((address) => hydrateDevice(address, config, wallet, homeDir)));
}

export async function discoverAgents(
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<AgentFile[]> {
  const registry = getRegistryReadContract(config);
  const count = (await registry.read.getAgentCount()) as bigint;
  const addresses = await readPages(
    count,
    (offset, limit) => registry.read.getAgents([offset, limit]) as Promise<readonly Address[]>,
  );
  return Promise.all(addresses.map((address) => hydrateAgent(address, config, wallet, homeDir)));
}

export async function discoverOwnedAgents(
  config: Config,
  wallet: WalletFile,
  homeDir?: string,
): Promise<AgentFile[]> {
  const agents = await discoverAgents(config, wallet, homeDir);
  return agents.filter((agent) => sameAddress(agent.owner, wallet.address));
}

export async function resolveGroup(
  query: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<GroupFile> {
  if (isAddress(query)) return hydrateGroup(query, config, wallet, homeDir);

  const local = listGroups(homeDir).filter((group) => group.name === query);
  if (local.length === 1) return local[0];
  if (local.length > 1) {
    return requireUnique(
      local.map((group) => ({ ...group, address: group.groupAddress, name: group.name })),
      "group",
      query,
    ) as unknown as GroupFile;
  }

  const remote = (await discoverGroups(config, wallet, homeDir)).filter(
    (group) => group.name === query,
  );
  return requireUnique(
    remote.map((group) => ({ ...group, address: group.groupAddress, name: group.name })),
    "group",
    query,
  ) as unknown as GroupFile;
}

export async function resolveDevice(
  query: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
  groupAddress?: string,
): Promise<DeviceFile> {
  if (isAddress(query)) return hydrateDevice(query, config, wallet, homeDir);

  const local = listDevices(homeDir).filter(
    (device) =>
      device.name === query && (!groupAddress || sameAddress(device.groupAddress, groupAddress)),
  );
  if (local.length === 1) return local[0];
  if (local.length > 1) {
    return requireUnique(
      local.map((device) => ({ ...device, address: device.deviceContract, name: device.name })),
      "device",
      query,
    ) as unknown as DeviceFile;
  }

  const groups = groupAddress
    ? [await hydrateGroup(groupAddress, config, wallet, homeDir)]
    : await discoverGroups(config, wallet, homeDir);
  const discovered: DeviceFile[] = [];
  for (const group of groups) {
    discovered.push(...(await discoverDevices(config, group.groupAddress, wallet, homeDir)));
  }
  const remote = discovered.filter((device) => device.name === query);
  return requireUnique(
    remote.map((device) => ({ ...device, address: device.deviceContract, name: device.name })),
    "device",
    query,
  ) as unknown as DeviceFile;
}

export async function resolveAgent(
  query: string,
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<AgentFile> {
  if (isAddress(query)) return hydrateAgent(query, config, wallet, homeDir);

  const local = listAgents(homeDir).filter(
    (agent) => agent.name === query || agent.agentId === query,
  );
  if (local.length === 1) return local[0];
  if (local.length > 1) {
    return requireUnique(
      local.map((agent) => ({ ...agent, address: agent.agentContract, name: agent.agentId })),
      "agent",
      query,
    ) as unknown as AgentFile;
  }

  const remote = (await discoverAgents(config, wallet, homeDir)).filter(
    (agent) => agent.name === query || agent.agentId === query,
  );
  return requireUnique(
    remote.map((agent) => ({ ...agent, address: agent.agentContract, name: agent.agentId })),
    "agent",
    query,
  ) as unknown as AgentFile;
}

export async function syncLocalCache(
  config: Config,
  wallet?: WalletFile,
  homeDir?: string,
): Promise<{
  groups: GroupFile[];
  devices: DeviceFile[];
  agents: AgentFile[];
}> {
  const groups = await discoverGroups(config, wallet, homeDir);
  const devices: DeviceFile[] = [];
  for (const group of groups) {
    devices.push(...(await discoverDevices(config, group.groupAddress, wallet, homeDir)));
  }
  const agents = await discoverAgents(config, wallet, homeDir);
  return { groups, devices, agents };
}

export function enforceModeConstraints(
  mode: SmartClawsMode,
  input: { group?: GroupFile | null; agent?: AgentFile | null; devices?: DeviceFile[] | null },
): void {
  const devices = input.devices ?? [];
  if (mode === "controller") {
    if (input.agent)
      throw new SmartClawsError("MODE_CONSTRAINT", "controller mode cannot attach an agent.");
    return;
  }

  if (mode === "bridge-agent") {
    if (!input.agent)
      throw new SmartClawsError("MODE_CONSTRAINT", "bridge-agent mode requires exactly one agent.");
    if (devices.length !== 1) {
      throw new SmartClawsError(
        "MODE_CONSTRAINT",
        "bridge-agent mode requires exactly one device.",
        { count: devices.length },
      );
    }
    return;
  }

  if (mode === "master-agent") {
    if (!input.agent)
      throw new SmartClawsError("MODE_CONSTRAINT", "master-agent mode requires exactly one agent.");
    if (!input.group)
      throw new SmartClawsError("MODE_CONSTRAINT", "master-agent mode requires exactly one group.");
    const outsideGroup = devices.find(
      (device) => !sameAddress(device.groupAddress, input.group?.groupAddress),
    );
    if (outsideGroup) {
      throw new SmartClawsError(
        "MODE_CONSTRAINT",
        "master-agent devices must belong to the attached group.",
        {
          device: outsideGroup.deviceContract,
          group: outsideGroup.groupAddress,
        },
      );
    }
  }
}

export async function registerGroup(
  config: Config,
  wallet: WalletFile,
  name: string,
  skills = "",
  homeDir?: string,
): Promise<GroupFile> {
  const registry = getRegistryContract(config, wallet);
  const { publicClient } = getClients(config, wallet);
  const hash = await registry.write.registerDeviceGroup([name, skills]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let groupAddress: Address | null = null;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, config.contractAddress)) continue;
    try {
      const decoded = decodeEventLog({ abi: registry.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "DeviceGroupRegistered") {
        groupAddress = (decoded.args as unknown as { deviceGroup: Address }).deviceGroup;
      }
    } catch {}
  }
  if (!groupAddress)
    throw new SmartClawsError("ENTITY_NOT_FOUND", "DeviceGroupRegistered event was not found.");
  return hydrateGroup(groupAddress, config, wallet, homeDir);
}

export async function registerDevice(
  config: Config,
  wallet: WalletFile,
  groupAddress: string,
  name: string,
  capacity: bigint,
  homeDir?: string,
): Promise<DeviceFile> {
  const address = normalizeAddress(groupAddress);
  const group = getDeviceGroupContract(address, config, wallet);
  const { publicClient, account } = getClients(config, wallet);
  const hash = await group.write.registerDevice([name, account.address, capacity]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let deviceAddress: Address | null = null;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, address)) continue;
    try {
      const decoded = decodeEventLog({ abi: group.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "DeviceRegistered") {
        deviceAddress = (decoded.args as unknown as { device: Address }).device;
      }
    } catch {}
  }
  if (!deviceAddress)
    throw new SmartClawsError("ENTITY_NOT_FOUND", "DeviceRegistered event was not found.");
  return hydrateDevice(deviceAddress, config, wallet, homeDir);
}

export async function registerAgent(
  config: Config,
  wallet: WalletFile,
  name: string,
  metadata = "",
  capacity: bigint,
  homeDir?: string,
): Promise<AgentFile> {
  const registry = getRegistryContract(config, wallet);
  const { publicClient } = getClients(config, wallet);
  const hash = await registry.write.registerAgent([name, metadata, capacity]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let agentAddress: Address | null = null;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, config.contractAddress)) continue;
    try {
      const decoded = decodeEventLog({ abi: registry.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "AgentRegistered") {
        agentAddress = (decoded.args as unknown as { agent: Address }).agent;
      }
    } catch {}
  }
  if (!agentAddress)
    throw new SmartClawsError("ENTITY_NOT_FOUND", "AgentRegistered event was not found.");
  return hydrateAgent(agentAddress, config, wallet, homeDir);
}

function devicePermissionRoleId(role: DevicePermissionRole): `0x${string}` {
  if (role === "publisher") return PUBLISHER_ROLE;
  return MASTER_ROLE;
}

export async function grantDevicePermission(
  config: Config,
  wallet: WalletFile,
  deviceQuery: string,
  role: DevicePermissionRole,
  accountAddress: string,
  homeDir?: string,
): Promise<{
  device: DeviceFile;
  role: DevicePermissionRole;
  account: Address;
  txHash: `0x${string}`;
  status: "success" | "reverted";
}> {
  const device = await resolveDevice(deviceQuery, config, wallet, homeDir);
  const account = normalizeAddress(accountAddress);
  const contract = getDeviceWriteContract(normalizeAddress(device.deviceContract), config, wallet);
  const { publicClient } = getClients(config, wallet);

  const hash = await contract.write.grantRole([devicePermissionRoleId(role), account]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { device, role, account, txHash: hash, status: receipt.status };
}

export async function revokeDevicePermission(
  config: Config,
  wallet: WalletFile,
  deviceQuery: string,
  role: DevicePermissionRole,
  accountAddress: string,
  homeDir?: string,
): Promise<{
  device: DeviceFile;
  role: DevicePermissionRole;
  account: Address;
  txHash: `0x${string}`;
  status: "success" | "reverted";
}> {
  const device = await resolveDevice(deviceQuery, config, wallet, homeDir);
  const account = normalizeAddress(accountAddress);
  const contract = getDeviceWriteContract(normalizeAddress(device.deviceContract), config, wallet);
  const { publicClient } = getClients(config, wallet);

  const hash = await contract.write.revokeRole([devicePermissionRoleId(role), account]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { device, role, account, txHash: hash, status: receipt.status };
}

export const deviceRoleIds = {
  defaultAdmin: zeroHash,
  deviceAdmin: DEVICE_ADMIN_ROLE,
  publisher: PUBLISHER_ROLE,
  master: MASTER_ROLE,
} as const;
