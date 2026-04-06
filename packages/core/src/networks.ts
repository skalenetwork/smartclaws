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
  mainnet: {
    name: "Europa Mainnet",
    chainId: 2046399126,
    rpcUrl: "https://mainnet.skalenodes.com/v1/europa",
    chainName: "elated-tan-skat",
    explorerUrl: "https://elated-tan-skat.explorer.mainnet.skalenodes.com",
    nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
    registryAddress: "",
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
