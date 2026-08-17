export type SmartClawsMode = "controller" | "bridge-agent" | "master-agent";

export interface EntityCapabilities {
    isGroupOwner?: boolean;
    isAgentOwner?: boolean;
    isDeviceAdmin?: boolean;
    isPublisher?: boolean;
    isIncomingReader?: boolean;
    isOutgoingReader?: boolean;
    isMaster?: boolean;
    /** Agent AGENT_ADMIN_ROLE: administers the agent's publisher/sender roles. */
    isAgentAdmin?: boolean;
    /** Agent SENDER_ROLE: may publish to the agent's incoming channel. */
    isSender?: boolean;
}

export interface Config {
    /** Always 3 in memory: `migrateConfig` upgrades v1/v2 on load, so nothing downstream
     *  has to branch on version. Older versions exist only as on-disk JSON. */
    version: 3;
    network: string;
    chainId: number;
    rpcUrl: string;
    biteRpcUrl?: string;
    contractAddress: string;
    walletAddress: string;
    mode: SmartClawsMode;
    deviceGroupAddress: string;
    attachedGroupAddress: string;
    attachedAgentAddress: string;
    attachedDeviceAddresses: string[];
}

export interface LegacyConfigV1 {
    version: 1;
    network: string;
    chainId: number;
    rpcUrl: string;
    contractAddress: string;
    deviceGroupAddress: string;
}

export interface WalletFile {
    address: string;
    privateKey: string;
}

export interface GroupFile {
    name: string;
    groupAddress: string;
    skills: string;
    createdAt: number;
    owner: string;
    /** Total number of plain and encrypted devices, not the legacy plain-only count. */
    deviceCount: number;
    /** Canonical deduplicated list containing both plain and encrypted devices. */
    devices: string[];
    plainDevices?: string[];
    plainDeviceCount?: number;
    encryptedDevices?: string[];
    encryptedDeviceCount?: number;
    capabilities?: EntityCapabilities;
}

export interface DeviceFile {
    name: string;
    deviceContract: string;
    groupAddress?: string;
    createdAt?: number;
    incomingChannel: string;
    outgoingChannel: string;
    /** Missing on legacy records means unknown and must never be treated as plaintext. */
    encrypted?: boolean;
    capabilities?: EntityCapabilities;
}

export interface AgentFile {
    name: string;
    agentId: string;
    metadata: string;
    agentContract: string;
    incomingChannel: string;
    outgoingChannel: string;
    owner?: string;
    createdAt?: number;
    /** Missing on legacy records means unknown and must never be treated as plaintext. */
    encrypted?: boolean;
    capabilities?: EntityCapabilities;
}
