export interface Network {
    name: string;
    chainId: number;
    rpcUrl: string;
    chainName: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    registryAddress: string;
}

export const NETWORKS: Record<string, Network> = {
    "base-testnet": {
        name: "SKALE Base Testnet",
        chainId: 324705682,
        rpcUrl: "https://base-sepolia-testnet.skalenodes.com/v1/base-testnet",
        chainName: "skale-base-testnet",
        explorerUrl: "https://base-sepolia-testnet-explorer.skalenodes.com",
        nativeCurrency: { name: "CREDITS", symbol: "CREDITS", decimals: 18 },
        registryAddress: "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
    },
};

export const DEFAULT_NETWORK = "base-testnet";

export function getNetwork(name: string): Network {
    const network = NETWORKS[name];
    if (!network) {
        const available = Object.keys(NETWORKS).join(", ");
        throw new Error(`Unknown network '${name}'. Available: ${available}`);
    }
    return network;
}
