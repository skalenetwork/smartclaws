export type SmartClawsMode = "controller" | "bridge-agent" | "master-agent";

export interface EntityCapabilities {
  isGroupOwner?: boolean;
  isAgentOwner?: boolean;
  isDeviceAdmin?: boolean;
  isPublisher?: boolean;
  isMaster?: boolean;
  /** Agent AGENT_ADMIN_ROLE: administers the agent's publisher/sender roles. */
  isAgentAdmin?: boolean;
  /** Agent SENDER_ROLE: may publish to the agent's incoming channel. */
  isSender?: boolean;
}

export interface Config {
  version: 2;
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
  deviceCount: number;
  devices: string[];
  capabilities?: EntityCapabilities;
}

export interface DeviceFile {
  name: string;
  deviceContract: string;
  groupAddress?: string;
  createdAt?: number;
  incomingChannel: string;
  outgoingChannel: string;
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
  capabilities?: EntityCapabilities;
}
