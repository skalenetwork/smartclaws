export interface Config {
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

export interface DeviceFile {
  name: string;
  deviceContract: string;
  incomingChannel: string;
  outgoingChannel: string;
}

export interface AgentFile {
  name: string;
  agentId: string;
  metadata: string;
  agentContract: string;
  incomingChannel: string;
  outgoingChannel: string;
}
