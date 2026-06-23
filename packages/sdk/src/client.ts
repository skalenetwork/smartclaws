import { NETWORKS } from "@smartclaws/core/networks";
import type { Config } from "@smartclaws/core/types";
import { createPublicClient, defineChain, http } from "viem";

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
