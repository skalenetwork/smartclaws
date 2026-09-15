import { getNetwork, NETWORKS } from "@smartclaws/core/networks";
import { type Address, defineChain } from "viem";
import { createConfig, http, injected } from "wagmi";

const networkKey = import.meta.env.VITE_NETWORK || "base-testnet";
const network = getNetwork(networkKey);

const rpcUrl = (import.meta.env.VITE_RPC_URL as string) || network.rpcUrl;
const chainId = Number(import.meta.env.VITE_CHAIN_ID) || network.chainId;

export const registryAddress = ((import.meta.env.VITE_REGISTRY_ADDRESS as string) ||
    network.registryAddress) as Address;

export const explorerUrl = network.explorerUrl;
export const networkInfo = { key: networkKey, ...NETWORKS[networkKey] };

export const chain = defineChain({
    id: chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    // Lets a wallet that does not know this chain add it when asked to switch.
    blockExplorers: explorerUrl ? { default: { name: "Explorer", url: explorerUrl } } : undefined,
});

export const config = createConfig({
    chains: [chain],
    // Browser wallets only. Wallets announcing themselves via EIP-6963 are discovered on top
    // of this generic connector.
    connectors: [injected()],
    transports: { [chain.id]: http(rpcUrl) },
});
