import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatToolbox from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolbox],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "shanghai",
    },
  },
  chainDescriptors: {
    196243392: {
      name: "SKALE Sandbox",
      chainType: "generic",
      blockExplorers: {
        etherscan: {
          url: "https://vigilant-snappy-arcturus.base-sepolia-testnet-explorer.skalenodes.com",
          apiUrl:
            "https://vigilant-snappy-arcturus.base-sepolia-testnet-explorer.skalenodes.com/api",
        },
      },
    },
  },
  verify: {
    etherscan: { apiKey: "empty" },
    blockscout: { enabled: false },
    sourcify: { enabled: false },
  },
  networks: {
    ...(process.env.SKALE_RPC_URL
      ? {
        skaleTestnet: {
          type: "http" as const,
          chainId: 196243392,
          url: process.env.SKALE_RPC_URL,
          accounts: process.env.DEPLOYER_PRIVATE_KEY
            ? [process.env.DEPLOYER_PRIVATE_KEY]
            : [],
        },
      }
      : {}),
  },
});
