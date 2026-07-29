import { getNetwork, NETWORKS } from "@smartclaws/core/networks";
import { type Address, defineChain } from "viem";
import { createConfig, http } from "wagmi";

const networkKey = import.meta.env.VITE_NETWORK || "base-testnet";
const network = getNetwork(networkKey);

const rpcUrl = (import.meta.env.VITE_RPC_URL as string) || network.rpcUrl;
const chainId = Number(import.meta.env.VITE_CHAIN_ID) || network.chainId;

export const registryAddress = ((import.meta.env.VITE_REGISTRY_ADDRESS as string) ||
    network.registryAddress) as Address;

export const chain = defineChain({
    id: chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
});

export const explorerUrl = network.explorerUrl;
export const networkInfo = { key: networkKey, ...NETWORKS[networkKey] };

export const config = createConfig({
    chains: [chain],
    transports: { [chain.id]: http(rpcUrl) },
});
