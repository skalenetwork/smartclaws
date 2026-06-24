# SmartClaws Smart Contracts

On-chain message channels and device registry for the SmartClaws IoT platform, built on SKALE.

## Contracts

| Contract | Description |
|---|---|
| `SmartClaws` | Global registry — creates and tracks channels, device groups, and agents |
| `SmartClawsChannel` | Append-only message log with circular buffer pruning by byte capacity |
| `SmartClawsDeviceGroup` | Groups devices, handles registration and lifecycle |
| `SmartClawsAgent` | AI agent with dedicated incoming and outgoing channels |
| `SmartClawsDevice` | Immutable device record linking incoming/outgoing channels |

## Structure

```
smart-contracts/
├── contracts/          # Solidity source files
├── test/               # Mocha + Ethers tests
├── scripts/            # Deployment scripts
├── hardhat.config.ts   # Hardhat 3 config (ESM)
└── .solhint.json       # Solidity linter config
```

## Commands

```bash
npm install             # Install dependencies
npm run compile         # Compile contracts
npm test                # Run tests
npm run lint            # Lint Solidity
```

## Deploy

Set `SKALE_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in `.env`, then:

```bash
npx hardhat run scripts/deploy.ts --network baseTestnet
```

## Stack

- Hardhat 3 (ESM, TypeScript)
- Solidity 0.8.28, optimizer enabled, cancun EVM
- OpenZeppelin Contracts 5.x
- Mocha + Chai + Ethers.js
