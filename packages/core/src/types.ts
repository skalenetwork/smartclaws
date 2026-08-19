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
    version: 3;
    network: string;
    chainId: number;
    rpcUrl: string;
    contractAddress: string;
    walletAddress: string;
    mode: SmartClawsMode;
    deviceGroupAddress: string;
    attachedGroupAddress: string;
    attachedAgentAddress: string;
    attachedDeviceAddresses: string[];
}

export interface WalletFile {
    address: string;
    privateKey: string;
    /**
     * Optional key used only to open disclosures, kept separate from the signing key.
     *
     * `PublicKeyRegistry` stores whatever public key an account registers and never proves
     * ownership, so viewing can be decoupled from signing: register a key used only for
     * reading and rotate it freely without changing the wallet address — which matters
     * because reader ACLs are keyed by address, so a new address would lose every grant.
     * Absent means disclose and register cannot run until one is generated.
     */
    viewPrivateKey?: string;
}

export interface GroupFile {
    /** Summary records omit member address arrays; legacy records with arrays are fully hydrated. */
    hydration?: "summary" | "full";
    name: string;
    groupAddress: string;
    skills: string;
    createdAt: number;
    owner: string;
    /** Total number of plain and encrypted devices. */
    deviceCount: number;
    /** Canonical deduplicated list containing both plain and encrypted devices. */
    devices?: string[];
    plainDevices?: string[];
    plainDeviceCount?: number;
    encryptedDevices?: string[];
    encryptedDeviceCount?: number;
    capabilities?: EntityCapabilities;
}

export interface DeviceFile {
    /** Summary records omit channels and expensive capability reads. */
    hydration?: "summary" | "full";
    name: string;
    deviceContract: string;
    groupAddress?: string;
    createdAt?: number;
    incomingChannel?: string;
    outgoingChannel?: string;
    encrypted: boolean;
    capabilities?: EntityCapabilities;
}

export type HydratedGroupFile = GroupFile & {
    hydration?: "full";
    devices: string[];
};

export type HydratedDeviceFile = DeviceFile & {
    hydration?: "full";
    incomingChannel: string;
    outgoingChannel: string;
};

export interface AgentFile {
    name: string;
    agentId: string;
    metadata: string;
    agentContract: string;
    incomingChannel: string;
    outgoingChannel: string;
    owner?: string;
    createdAt?: number;
    encrypted: boolean;
    capabilities?: EntityCapabilities;
}
