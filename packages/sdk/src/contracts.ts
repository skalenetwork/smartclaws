import SmartClawsABI from "@smartclaws/core/abi/SmartClaws.json" with { type: "json" };
import SmartClawsAgentABI from "@smartclaws/core/abi/SmartClawsAgent.json" with { type: "json" };
import SmartClawsChannelABI from "@smartclaws/core/abi/SmartClawsChannel.json" with {
  type: "json",
};
import SmartClawsDeviceABI from "@smartclaws/core/abi/SmartClawsDevice.json" with { type: "json" };
import SmartClawsDeviceGroupABI from "@smartclaws/core/abi/SmartClawsDeviceGroup.json" with {
  type: "json",
};
import { NETWORKS } from "@smartclaws/core/networks";
import type { Config, WalletFile } from "@smartclaws/core/types";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function buildChain(config: Config) {
  const network = NETWORKS[config.network];
  return defineChain({
    id: config.chainId,
    name: network?.chainName ?? `skale-${config.chainId}`,
    nativeCurrency: network?.nativeCurrency ?? { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function getPublicClient(config: Config) {
  const chain = buildChain(config);
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

export function getClients(config: Config, wallet: WalletFile) {
  const chain = buildChain(config);
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
  return { publicClient, walletClient, account };
}

export function getRegistryContract(config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address: config.contractAddress as Address,
    abi: SmartClawsABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function getRegistryReadContract(config: Config) {
  const publicClient = getPublicClient(config);
  return getContract({
    address: config.contractAddress as Address,
    abi: SmartClawsABI.abi,
    client: publicClient,
  });
}

export function getDeviceGroupContract(address: Address, config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address,
    abi: SmartClawsDeviceGroupABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function getDeviceGroupReadContract(address: Address, config: Config) {
  const publicClient = getPublicClient(config);
  return getContract({
    address,
    abi: SmartClawsDeviceGroupABI.abi,
    client: publicClient,
  });
}

export function getDeviceContract(address: Address, config: Config) {
  const publicClient = getPublicClient(config);
  return getContract({
    address,
    abi: SmartClawsDeviceABI.abi,
    client: publicClient,
  });
}

export function getDeviceWriteContract(address: Address, config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address,
    abi: SmartClawsDeviceABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function getAgentContract(address: Address, config: Config) {
  const publicClient = getPublicClient(config);
  return getContract({
    address,
    abi: SmartClawsAgentABI.abi,
    client: publicClient,
  });
}

export function getAgentWriteContract(address: Address, config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address,
    abi: SmartClawsAgentABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function getChannelContract(address: Address, config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address,
    abi: SmartClawsChannelABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}
