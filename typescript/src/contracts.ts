import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SmartClawsABI from "../../abi/SmartClaws.json" with { type: "json" };
import SmartClawsChannelABI from "../../abi/SmartClawsChannel.json" with { type: "json" };
import SmartClawsDeviceABI from "../../abi/SmartClawsDevice.json" with { type: "json" };
import SmartClawsDeviceGroupABI from "../../abi/SmartClawsDeviceGroup.json" with { type: "json" };
import type { Config } from "./config.ts";
import { NETWORKS } from "./defaults.ts";
import type { WalletFile } from "./wallet.ts";

function buildChain(config: Config) {
  const network = NETWORKS[config.network];
  return defineChain({
    id: config.chainId,
    name: network?.chainName ?? `skale-${config.chainId}`,
    nativeCurrency: network?.nativeCurrency ?? { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
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

export function getDeviceGroupContract(address: Address, config: Config, wallet: WalletFile) {
  const { publicClient, walletClient } = getClients(config, wallet);
  return getContract({
    address,
    abi: SmartClawsDeviceGroupABI.abi,
    client: { public: publicClient, wallet: walletClient },
  });
}

export function getDeviceContract(address: Address, config: Config) {
  const chain = buildChain(config);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  return getContract({
    address,
    abi: SmartClawsDeviceABI.abi,
    client: publicClient,
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
