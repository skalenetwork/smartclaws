import { createPublicClient, defineChain, http } from "viem";
import type { Config } from "./config.ts";
import { NETWORKS } from "./defaults.ts";

export function createClient(config: Config) {
  const network = NETWORKS[config.network];
  const nativeCurrency = network?.nativeCurrency ?? {
    name: "sFUEL",
    symbol: "sFUEL",
    decimals: 18,
  };

  const chain = defineChain({
    id: config.chainId,
    name: network?.chainName ?? `skale-${config.chainId}`,
    nativeCurrency,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
  });

  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}
