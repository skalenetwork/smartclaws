# SmartClaws

IoT data platform on SKALE blockchain. On-chain message channels for device-to-agent communication, Python SDK for hardware integration.

## Smart Contracts (`smart-contracts/`)

Hardhat 3, ESM, Solidity 0.8.28, OpenZeppelin 5.x.

**Contracts:** `SmartClaws` (registry) → creates `SmartClawsChannel` (append-only message log), `SmartClawsDeviceGroup` (manages devices), `SmartClawsAgent` (AI agent with channels), `SmartClawsDevice` (device record).

**Key patterns:** custom errors (not require strings), `Ownable2Step`, `EnumerableSet`, `unchecked` increments. HH3 uses `defineConfig` + `plugins` array, ethers via `await hre.network.connect()`.

**Commands:** `npm test`, `npm run compile`, `npm run lint`.

## Python

Python 3.10+, managed with `uv`. BLE utilities for sensor communication.
