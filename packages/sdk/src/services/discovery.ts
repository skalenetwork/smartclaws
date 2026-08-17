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
import * as contracts from "../contracts.js";
import { listDevices, saveDevice } from "../device.js";
import { SmartClawsError } from "../errors.js";
import { listGroups, saveGroup } from "../group.js";

const DISCOVERY_PAGE_SIZE = 100n;
const DEVICE_ADMIN_ROLE = keccak256(toHex("DEVICE_ADMIN_ROLE"));
const PUBLISHER_ROLE = keccak256(toHex("PUBLISHER_ROLE"));
const MASTER_ROLE = keccak256(toHex("MASTER_ROLE"));
const AGENT_ADMIN_ROLE = keccak256(toHex("AGENT_ADMIN_ROLE"));
const SENDER_ROLE = keccak256(toHex("SENDER_ROLE"));

type NamedRecord = { address: string; name: string };
export type DevicePermissionRole = "publisher" | "master";
export type AgentPermissionRole = "publisher" | "sender" | "agent-admin";
export type RegistrationKind = { encrypted?: boolean };

export function mergeDeviceSets(
    plain: readonly Address[],
    encrypted: readonly Address[],
): {
    devices: Address[];
    deviceCount: number;
    plainDevices: Address[];
    plainDeviceCount: number;
    encryptedDevices: Address[];
    encryptedDeviceCount: number;
} {
    const encryptedSet = new Set(encrypted.map((address) => address.toLowerCase()));
    const devices: Address[] = [];
    const seen = new Set<string>();
    for (const address of [...encrypted, ...plain]) {
        const key = address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        devices.push(normalizeAddress(address));
    }
    return {
        devices,
        deviceCount: devices.length,
        plainDevices: plain
            .filter((address) => !encryptedSet.has(address.toLowerCase()))
            .map(normalizeAddress),
        plainDeviceCount: plain.filter((address) => !encryptedSet.has(address.toLowerCase()))
            .length,
        encryptedDevices: encrypted.map(normalizeAddress),
        encryptedDeviceCount: encrypted.length,
    };
}

export function assertRegistrationKind(requested: boolean, actual: boolean): void {
    if (requested === actual) return;
    throw new SmartClawsError(
        "REGISTRATION_KIND_MISMATCH",
        `On-chain registration produced encrypted=${actual}, but encrypted=${requested} was requested.`,
        { requested, actual },
    );
}

function requireRegistrationEncryptedFlag(
    eventEncrypted: boolean | undefined,
    eventName: string,
    details: Record<string, unknown>,
): asserts eventEncrypted is boolean {
    if (eventEncrypted === undefined) {
        throw new SmartClawsError(
            "REGISTRATION_KIND_MISMATCH",
            `${eventName} did not include an encrypted flag.`,
            details,
        );
    }
}

async function readGroupDeviceSets(group: {
    read: {
        getDeviceCount: () => Promise<bigint>;
        getDevices: (args: [bigint, bigint]) => Promise<readonly Address[]>;
        getEncryptedDeviceCount: () => Promise<bigint>;
        getEncryptedDevices: (args: [bigint, bigint]) => Promise<readonly Address[]>;
    };
}): Promise<{ plain: Address[]; encrypted: Address[] }> {
    const [plainCount, encryptedCount] = await Promise.all([
        group.read.getDeviceCount(),
        group.read.getEncryptedDeviceCount(),
    ]);
    const [plain, encrypted] = await Promise.all([
        readPages(plainCount, (offset, limit) => group.read.getDevices([offset, limit])),
        readPages(encryptedCount, (offset, limit) =>
            group.read.getEncryptedDevices([offset, limit]),
        ),
    ]);
    return { plain, encrypted };
}

async function readReaderMembership(
    incomingChannel: Address,
    outgoingChannel: Address,
    account: Address,
    config: Config,
): Promise<{ isIncomingReader: boolean; isOutgoingReader: boolean }> {
    const incoming = contracts.getEncryptedChannelReadContract(incomingChannel, config);
    const outgoing = contracts.getEncryptedChannelReadContract(outgoingChannel, config);
    const [isIncomingReader, isOutgoingReader] = await Promise.all([
        incoming.read.isAuthorizedReader([account]) as Promise<boolean>,
        outgoing.read.isAuthorizedReader([account]) as Promise<boolean>,
    ]);
    return { isIncomingReader, isOutgoingReader };
}

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
    knownEncrypted?: boolean,
): Promise<DeviceFile> {
    const address = normalizeAddress(deviceAddress);
    const device = contracts.getDeviceContract(address, config);

    const [name, groupAddress, createdAt, incomingChannel, outgoingChannel] = await Promise.all([
        device.read.deviceId() as Promise<string>,
        device.read.group() as Promise<Address>,
        device.read.createdAt() as Promise<bigint>,
        device.read.getIncomingMessagesChannel() as Promise<Address>,
        device.read.getOutgoingMessagesChannel() as Promise<Address>,
    ]);

    const encrypted =
        knownEncrypted ??
        (await contracts.resolveChannelEncrypted(incomingChannel as Address, config));
    contracts.rememberChannelEncrypted(incomingChannel as Address, encrypted);
    contracts.rememberChannelEncrypted(outgoingChannel as Address, encrypted);

    const capabilities: EntityCapabilities = {};
    if (wallet) {
        const account = normalizeAddress(wallet.address);
        const [isDeviceAdmin, isPublisher, isMaster, readers] = await Promise.all([
            device.read.hasRole([DEVICE_ADMIN_ROLE, account]) as Promise<boolean>,
            device.read.hasRole([PUBLISHER_ROLE, account]) as Promise<boolean>,
            device.read.hasRole([MASTER_ROLE, account]) as Promise<boolean>,
            encrypted
                ? readReaderMembership(
                      incomingChannel as Address,
                      outgoingChannel as Address,
                      account,
                      config,
                  )
                : Promise.resolve(undefined),
        ]);
        capabilities.isDeviceAdmin = isDeviceAdmin;
        capabilities.isPublisher = isPublisher;
        capabilities.isMaster = isMaster;
        if (readers) {
            capabilities.isIncomingReader = readers.isIncomingReader;
            capabilities.isOutgoingReader = readers.isOutgoingReader;
        }
    }

    const record: DeviceFile = {
        name,
        deviceContract: address,
        groupAddress,
        createdAt: Number(createdAt),
        incomingChannel,
        outgoingChannel,
        encrypted,
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
    const group = contracts.getDeviceGroupReadContract(address, config);

    const [name, skills, createdAt, owner, deviceSets] = await Promise.all([
        group.read.groupName() as Promise<string>,
        group.read.skills() as Promise<string>,
        group.read.createdAt() as Promise<bigint>,
        group.read.owner() as Promise<Address>,
        readGroupDeviceSets(group as never),
    ]);
    const merged = mergeDeviceSets(deviceSets.plain, deviceSets.encrypted);

    const capabilities: EntityCapabilities = {};
    if (wallet) capabilities.isGroupOwner = sameAddress(owner, wallet.address);

    const record: GroupFile = {
        name,
        groupAddress: address,
        skills,
        createdAt: Number(createdAt),
        owner,
        ...merged,
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
    knownEncrypted?: boolean,
): Promise<AgentFile> {
    const address = normalizeAddress(agentAddress);
    const agent = contracts.getAgentContract(address, config);

    const [agentId, metadata, createdAt, owner, incomingChannel, outgoingChannel] =
        await Promise.all([
            agent.read.agentId() as Promise<string>,
            agent.read.metadata() as Promise<string>,
            agent.read.createdAt() as Promise<bigint>,
            agent.read.owner() as Promise<Address>,
            agent.read.getIncomingMessagesChannel() as Promise<Address>,
            agent.read.getOutgoingMessagesChannel() as Promise<Address>,
        ]);

    const encrypted =
        knownEncrypted ??
        (await contracts.resolveChannelEncrypted(incomingChannel as Address, config));
    contracts.rememberChannelEncrypted(incomingChannel as Address, encrypted);
    contracts.rememberChannelEncrypted(outgoingChannel as Address, encrypted);

    const capabilities: EntityCapabilities = {};
    if (wallet) {
        capabilities.isAgentOwner = sameAddress(owner, wallet.address);
        const account = normalizeAddress(wallet.address);
        const [isAgentAdmin, isPublisher, isSender, readers] = await Promise.all([
            agent.read.hasRole([AGENT_ADMIN_ROLE, account]) as Promise<boolean>,
            agent.read.hasRole([PUBLISHER_ROLE, account]) as Promise<boolean>,
            agent.read.hasRole([SENDER_ROLE, account]) as Promise<boolean>,
            encrypted
                ? readReaderMembership(
                      incomingChannel as Address,
                      outgoingChannel as Address,
                      account,
                      config,
                  )
                : Promise.resolve(undefined),
        ]);
        capabilities.isAgentAdmin = isAgentAdmin;
        capabilities.isPublisher = isPublisher;
        capabilities.isSender = isSender;
        if (readers) {
            capabilities.isIncomingReader = readers.isIncomingReader;
            capabilities.isOutgoingReader = readers.isOutgoingReader;
        }
    }

    const record: AgentFile = {
        name: agentId,
        agentId,
        metadata,
        agentContract: address,
        incomingChannel,
        outgoingChannel,
        owner,
        createdAt: Number(createdAt),
        encrypted,
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
    const registry = contracts.getRegistryReadContract(config);
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
    const group = contracts.getDeviceGroupReadContract(normalizeAddress(groupAddress), config);
    const { plain, encrypted } = await readGroupDeviceSets(group as never);
    const encryptedSet = new Set(encrypted.map((address) => address.toLowerCase()));
    return Promise.all([
        ...encrypted.map((address) => hydrateDevice(address, config, wallet, homeDir, true)),
        ...plain
            .filter((address) => !encryptedSet.has(address.toLowerCase()))
            .map((address) => hydrateDevice(address, config, wallet, homeDir, false)),
    ]);
}

export async function discoverAgents(
    config: Config,
    wallet?: WalletFile,
    homeDir?: string,
): Promise<AgentFile[]> {
    const registry = contracts.getRegistryReadContract(config);
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
            device.name === query &&
            (!groupAddress || sameAddress(device.groupAddress, groupAddress)),
    );
    if (local.length === 1) return local[0];
    if (local.length > 1) {
        return requireUnique(
            local.map((device) => ({
                ...device,
                address: device.deviceContract,
                name: device.name,
            })),
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
            throw new SmartClawsError(
                "MODE_CONSTRAINT",
                "bridge-agent mode requires exactly one agent.",
            );
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
            throw new SmartClawsError(
                "MODE_CONSTRAINT",
                "master-agent mode requires exactly one agent.",
            );
        if (!input.group)
            throw new SmartClawsError(
                "MODE_CONSTRAINT",
                "master-agent mode requires exactly one group.",
            );
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
    const registry = contracts.getRegistryContract(config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = await registry.write.registerDeviceGroup([name, skills]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    let groupAddress: Address | null = null;
    for (const log of receipt.logs) {
        if (!sameAddress(log.address, config.contractAddress)) continue;
        try {
            const decoded = decodeEventLog({
                abi: registry.abi,
                data: log.data,
                topics: log.topics,
            });
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
    options: RegistrationKind = {},
): Promise<DeviceFile> {
    const requestedEncrypted = Boolean(options.encrypted);
    const address = normalizeAddress(groupAddress);
    const group = contracts.getDeviceGroupContract(address, config, wallet);
    const { publicClient, account } = contracts.getClients(config, wallet);
    const hash = requestedEncrypted
        ? await group.write.registerEncryptedDevice([name, account.address, capacity])
        : await group.write.registerDevice([name, account.address, capacity]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    let deviceAddress: Address | null = null;
    let eventEncrypted: boolean | undefined;
    for (const log of receipt.logs) {
        if (!sameAddress(log.address, address)) continue;
        try {
            const decoded = decodeEventLog({ abi: group.abi, data: log.data, topics: log.topics });
            if (decoded.eventName === "DeviceRegistered") {
                const args = decoded.args as unknown as { device: Address; encrypted?: boolean };
                deviceAddress = args.device;
                eventEncrypted = args.encrypted;
            }
        } catch {}
    }
    if (!deviceAddress)
        throw new SmartClawsError("ENTITY_NOT_FOUND", "DeviceRegistered event was not found.");
    requireRegistrationEncryptedFlag(eventEncrypted, "DeviceRegistered", { device: deviceAddress });
    assertRegistrationKind(requestedEncrypted, eventEncrypted);
    return hydrateDevice(deviceAddress, config, wallet, homeDir, eventEncrypted);
}

export async function registerAgent(
    config: Config,
    wallet: WalletFile,
    name: string,
    metadata = "",
    capacity: bigint,
    homeDir?: string,
    options: RegistrationKind = {},
): Promise<AgentFile> {
    const requestedEncrypted = Boolean(options.encrypted);
    const registry = contracts.getRegistryContract(config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const hash = requestedEncrypted
        ? await registry.write.registerEncryptedAgent([name, metadata, capacity])
        : await registry.write.registerAgent([name, metadata, capacity]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    let agentAddress: Address | null = null;
    let eventEncrypted: boolean | undefined;
    for (const log of receipt.logs) {
        if (!sameAddress(log.address, config.contractAddress)) continue;
        try {
            const decoded = decodeEventLog({
                abi: registry.abi,
                data: log.data,
                topics: log.topics,
            });
            if (decoded.eventName === "AgentRegistered") {
                const args = decoded.args as unknown as { agent: Address; encrypted?: boolean };
                agentAddress = args.agent;
                eventEncrypted = args.encrypted;
            }
        } catch {}
    }
    if (!agentAddress)
        throw new SmartClawsError("ENTITY_NOT_FOUND", "AgentRegistered event was not found.");
    requireRegistrationEncryptedFlag(eventEncrypted, "AgentRegistered", { agent: agentAddress });
    assertRegistrationKind(requestedEncrypted, eventEncrypted);
    return hydrateAgent(agentAddress, config, wallet, homeDir, eventEncrypted);
}

export async function createChannel(
    config: Config,
    wallet: WalletFile,
    ownerAddress: string,
    capacity: bigint,
    options: RegistrationKind = {},
): Promise<{ channel: Address; encrypted: boolean; txHash: `0x${string}` }> {
    const requestedEncrypted = Boolean(options.encrypted);
    const registry = contracts.getRegistryContract(config, wallet);
    const { publicClient } = contracts.getClients(config, wallet);
    const owner = normalizeAddress(ownerAddress);
    const hash = requestedEncrypted
        ? await registry.write.createEncryptedChannel([owner, capacity])
        : await registry.write.createChannel([owner, capacity]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    let channel: Address | null = null;
    let eventEncrypted: boolean | undefined;
    for (const log of receipt.logs) {
        if (!sameAddress(log.address, config.contractAddress)) continue;
        try {
            const decoded = decodeEventLog({
                abi: registry.abi,
                data: log.data,
                topics: log.topics,
            });
            if (decoded.eventName === "ChannelCreated") {
                const args = decoded.args as unknown as { channel: Address; encrypted?: boolean };
                channel = args.channel;
                eventEncrypted = args.encrypted;
            }
        } catch {}
    }
    if (!channel)
        throw new SmartClawsError("ENTITY_NOT_FOUND", "ChannelCreated event was not found.");
    requireRegistrationEncryptedFlag(eventEncrypted, "ChannelCreated", { channel });
    assertRegistrationKind(requestedEncrypted, eventEncrypted);
    contracts.rememberChannelEncrypted(channel, eventEncrypted);
    return { channel, encrypted: eventEncrypted, txHash: hash };
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
    const contract = contracts.getDeviceWriteContract(
        normalizeAddress(device.deviceContract),
        config,
        wallet,
    );
    const { publicClient } = contracts.getClients(config, wallet);

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
    const contract = contracts.getDeviceWriteContract(
        normalizeAddress(device.deviceContract),
        config,
        wallet,
    );
    const { publicClient } = contracts.getClients(config, wallet);

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

function agentPermissionRoleId(role: AgentPermissionRole): `0x${string}` {
    if (role === "publisher") return PUBLISHER_ROLE;
    if (role === "sender") return SENDER_ROLE;
    return AGENT_ADMIN_ROLE;
}

export async function grantAgentPermission(
    config: Config,
    wallet: WalletFile,
    agentQuery: string,
    role: AgentPermissionRole,
    accountAddress: string,
    homeDir?: string,
): Promise<{
    agent: AgentFile;
    role: AgentPermissionRole;
    account: Address;
    txHash: `0x${string}`;
    status: "success" | "reverted";
}> {
    const agent = await resolveAgent(agentQuery, config, wallet, homeDir);
    const account = normalizeAddress(accountAddress);
    const contract = contracts.getAgentWriteContract(
        normalizeAddress(agent.agentContract),
        config,
        wallet,
    );
    const { publicClient } = contracts.getClients(config, wallet);

    const hash = await contract.write.grantRole([agentPermissionRoleId(role), account]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { agent, role, account, txHash: hash, status: receipt.status };
}

export async function revokeAgentPermission(
    config: Config,
    wallet: WalletFile,
    agentQuery: string,
    role: AgentPermissionRole,
    accountAddress: string,
    homeDir?: string,
): Promise<{
    agent: AgentFile;
    role: AgentPermissionRole;
    account: Address;
    txHash: `0x${string}`;
    status: "success" | "reverted";
}> {
    const agent = await resolveAgent(agentQuery, config, wallet, homeDir);
    const account = normalizeAddress(accountAddress);
    const contract = contracts.getAgentWriteContract(
        normalizeAddress(agent.agentContract),
        config,
        wallet,
    );
    const { publicClient } = contracts.getClients(config, wallet);

    const hash = await contract.write.revokeRole([agentPermissionRoleId(role), account]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { agent, role, account, txHash: hash, status: receipt.status };
}

export const agentRoleIds = {
    defaultAdmin: zeroHash,
    agentAdmin: AGENT_ADMIN_ROLE,
    publisher: PUBLISHER_ROLE,
    sender: SENDER_ROLE,
} as const;
