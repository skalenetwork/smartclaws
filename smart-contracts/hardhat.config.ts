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
        324705682: {
            name: "SKALE Base Testnet",
            chainType: "generic",
            blockExplorers: {
                etherscan: {
                    url: "https://base-sepolia-testnet-explorer.skalenodes.com",
                    apiUrl: "https://base-sepolia-testnet-explorer.skalenodes.com/api",
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
                  baseTestnet: {
                      type: "http" as const,
                      chainId: process.env.SKALE_CHAIN_ID
                          ? Number(process.env.SKALE_CHAIN_ID)
                          : 324705682,
                      url: process.env.SKALE_RPC_URL,
                      accounts: process.env.DEPLOYER_PRIVATE_KEY
                          ? [process.env.DEPLOYER_PRIVATE_KEY]
                          : [],
                  },
              }
            : {}),
    },
});
