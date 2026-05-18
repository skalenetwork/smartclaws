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
  testnet: {
    name: "SKALE Sandbox",
    chainId: 196243392,
    rpcUrl: "https://base-sepolia-testnet.skalenodes.com/v1/vigilant-snappy-arcturus",
    chainName: "skale-sandbox",
    explorerUrl: "https://vigilant-snappy-arcturus.base-sepolia-testnet-explorer.skalenodes.com",
    nativeCurrency: { name: "CREDITS", symbol: "CREDITS", decimals: 18 },
    registryAddress: "0x18B62f70ddaA2666FA5933a7b6Ff3943e69ca690",
  },
  "base-testnet": {
    name: "SKALE Base Testnet",
    chainId: 324705682,
    rpcUrl: "https://base-sepolia-testnet.skalenodes.com/v1/base-testnet",
    chainName: "skale-base-testnet",
    explorerUrl: "https://base-sepolia-testnet-explorer.skalenodes.com",
    nativeCurrency: { name: "CREDITS", symbol: "CREDITS", decimals: 18 },
    registryAddress: "0xDF81Ef386fe69Cd2C4de595Af4c144CbbcB7aA49",
  },
};

export const DEFAULT_NETWORK = "testnet";

export function getNetwork(name: string): Network {
  const network = NETWORKS[name];
  if (!network) {
    const available = Object.keys(NETWORKS).join(", ");
    throw new Error(`Unknown network '${name}'. Available: ${available}`);
  }
  return network;
}
