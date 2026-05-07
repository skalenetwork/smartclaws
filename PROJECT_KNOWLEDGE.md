# SmartClaws Project Knowledge

This file captures the current repository state after re-reading the project. It replaces the older snapshot that described the pre-monorepo layout.

## Purpose

SmartClaws publishes and reads IoT sensor data on the SKALE blockchain. The project now combines:

- Solidity contracts for an on-chain registry, device groups, devices, agents, and append-only message channels.
- A shared TypeScript core package with envelope encoding, network defaults, types, random names, and ABI artifacts.
- A Bun-built TypeScript CLI for initializing local config, managing a wallet, registering a device group, registering local devices, publishing readings, and reading messages.
- A React dashboard for read-only monitoring of registry stats, device groups, devices, channels, decoded sensor messages, and charts.
- Agent skills that teach compatible AI agents how to set up producers and readers.
- Python BLE scripts for Xiaomi LYWSD03-style sensors that publish through the `smartclaws` CLI.
- Helper scripts for SKALE infrastructure operations.

The repo version is `0.3.0` across the root package, core, CLI, dashboard, contracts, and Python package.

## Repository Map

```text
README.md
  User-facing overview, quick start, skill install/publish instructions.

package.json
  Private Bun workspace root. Workspaces: packages/* and smart-contracts.

packages/core/
  @smartclaws/core: shared types, envelope, networks, name generation, ABI exports.

packages/cli/
  @smartclaws/cli: Bun/Commander CLI for SmartClaws device producer and reader flows.

packages/dashboard/
  @smartclaws/dashboard: Vite + React read-only monitoring UI.

smart-contracts/
  @skalenetwork/smartclaws-contracts: Hardhat 3 Solidity contracts.

python/
  smartclaws Python package scaffold plus BLE scripts.

skills/
  smartclaws-producer and smartclaws-reader Agent Skills.

scripts/
  Local repo scripts for Anvil and version checks/bumps.

helper-scripts/
  SKALE operational helper scripts.
```

The old `typescript/` package and root `abi/` directory are no longer present. ABIs now live under `packages/core/abi`.

## Current Capabilities

SmartClaws can already:

- Create standalone message channels on-chain.
- Register device groups with a name and `skills` metadata string.
- Register devices under a device group, creating incoming and outgoing channels for each device.
- Publish device readings to a device's outgoing channel through `smartclaws publish`.
- Read messages from a local device or arbitrary channel through `smartclaws read`.
- Decode SmartClaws v1 JSON envelopes in CLI, core, tests, and dashboard.
- Display device groups, devices, channel messages, payload tables, and simple charts in the dashboard.
- Provide producer and reader workflows to AI agents through `skills/smartclaws-producer` and `skills/smartclaws-reader`.
- Publish BLE sensor readings through Python scripts that shell out to the CLI.

SmartClaws does not yet provide:

- CLI commands for on-chain agent registration or agent messaging.
- CLI commands for standalone channel creation/deletion.
- CLI unregister flows.
- Dashboard write flows.
- A real Python SDK implementation beyond package scaffold and scripts.

## Smart Contract Model

Contracts live in `smart-contracts/contracts`.

### `SmartClaws`

`SmartClaws` is the global permissionless registry and factory. It has no owner/admin.

Tracked sets:

- `_channels`
- `_deviceGroups`
- `_agents`

Write functions:

- `createChannel(ownerAddress, maxCapacityBytes)` deploys and registers a `SmartClawsChannel`.
- `deleteChannel(channelAddress)` verifies caller ownership, disables writes, and removes the channel from the registry.
- `registerDeviceGroup(deviceGroupName, skills_)` deploys and registers a `SmartClawsDeviceGroup` owned by the caller.
- `unregisterDeviceGroup(deviceGroup)` verifies group ownership, deactivates the group, and removes it from the registry.
- `registerAgent(agentId, metadata, channelCapacity)` deploys two channels plus a `SmartClawsAgent`.
- `unregisterAgent(agent)` verifies ownership, disables the agent outgoing channel, deactivates the agent, and removes it from the registry.

Read functions:

- `getChannels()`, `getChannelCount()`, `isRegisteredChannel(address)`
- `getDeviceGroups()`, `getDeviceGroupCount()`, `isRegisteredDeviceGroup(address)`
- `getAgents()`, `getAgentCount()`, `isRegisteredAgent(address)`

Important details:

- `agentId` and `metadata` are emitted in `AgentRegistered` but are not stored on the agent contract.
- `unregisterAgent` disables only the outgoing channel. The incoming channel remains writable unless separately disabled by its owner.

### `SmartClawsChannel`

`SmartClawsChannel` is an append-only opaque byte log with capacity pruning.

Key state:

- `registry`: immutable registry address.
- `maxCapacityBytes`: immutable byte capacity.
- `totalBytes`: bytes currently stored.
- `startOffset`: oldest available offset.
- `nextOffset`: next offset to write.
- `writesEnabled`: permanent write gate.
- `_messages`: offset to bytes payload.
- `_messageSizes`: offset to byte size.
- `_publishers`: authorized non-owner publishers.

Write functions:

- `publishMessage(bytes payload)` appends a non-empty payload if the caller is owner or an authorized publisher.
- `disableWrites()` permanently disables writes; callable by owner or registry.
- `addPublisher(address)` and `removePublisher(address)` manage publisher ACLs.

Read functions:

- `readMessage(offset)`
- `readMessages(fromOffset, count)`
- `getLatestMessageOffset()`
- `getOldestMessageOffset()`
- `getMessageCount()`
- `isAuthorizedPublisher(account)`
- `getPublishers()`
- `getMaxCapacityBytes()`

Pruning is done in a loop while `totalBytes + payloadSize > maxCapacityBytes`. This preserves the newest data but can be gas-heavy for many small messages.

### `SmartClawsDeviceGroup`

`SmartClawsDeviceGroup` is an `Ownable2Step` group of devices.

Key state:

- `registry`: immutable registry address.
- `groupName`: human-readable group name.
- `skills`: arbitrary capability metadata string.
- `active`: device registration gate.
- `_deviceInfo`: device address to `DeviceInfo`.
- `_deviceList`: append-only list of device addresses.

Write functions:

- `registerDevice(deviceId, devicePublisher, channelCapacity)` is owner-only. It creates incoming and outgoing channels owned by the group contract, grants `devicePublisher` publishing access on the outgoing channel, deploys `SmartClawsDevice`, stores device info, and emits `DeviceRegistered`.
- `unregisterDevice(device)` is owner-only. It removes the publisher from the outgoing channel, tries to remove it from the incoming channel, marks the device unregistered, and emits `DeviceUnregistered`.
- `deactivate()` is registry-only.

Read functions:

- `getDeviceInfo(device)`
- `getDevices()`
- `getDeviceCount()`

Important detail: device channels are owned by the group contract, not by the human wallet directly. The device publisher wallet is only authorized on the outgoing channel.

### `SmartClawsDevice`

`SmartClawsDevice` is an immutable record for a device.

Fields:

- `incomingChannel`
- `outgoingChannel`
- `publisher`
- `group`

Read helpers:

- `getIncomingMessagesChannel()`
- `getOutgoingMessagesChannel()`

### `SmartClawsAgent`

`SmartClawsAgent` is an `Ownable2Step` agent with fixed incoming and outgoing channels.

Fields:

- `registry`
- `incomingChannel`
- `outgoingChannel`
- `active`

Functions:

- `deactivate()` is registry-only.
- `getIncomingMessagesChannel()`
- `getOutgoingMessagesChannel()`

Ownership transfer cascades to both channels by overriding `_transferOwnership`.

## Agent Capability Answer

On-chain, an agent created through `SmartClaws.registerAgent` owns its incoming and outgoing channels, so the owner can publish to those channels and read from any public channel using normal channel functions.

In current project tooling:

- The contracts support agent channel publish/read.
- The checked-in CLI does not yet expose `registerAgent`, agent publishing, or agent reading commands.
- The dashboard has an `/agents` route, but it is a placeholder.
- The OpenClaw skills currently model producer/reader workflows through device groups, devices, and channels, not automatic on-chain `SmartClawsAgent` registration.

So the accurate answer is: yes at the contract/API level, no as a first-class CLI/dashboard workflow yet.

## Skills Semantics

There are two different “skills” concepts:

1. Device group `skills`: the on-chain `SmartClawsDeviceGroup.skills` string.
2. Agent Skill directories: `skills/smartclaws-producer` and `skills/smartclaws-reader`.

The on-chain `skills` string is arbitrary metadata passed to `registerDeviceGroup`. The dashboard treats it as a comma-separated list for display in skill chips and group detail. The contracts do not parse, validate, hash, version, or enforce it.

The Agent Skill directories contain `SKILL.md` files following the Agent Skills / OpenClaw style. These are operational instructions for compatible AI agents and are not automatically tied to on-chain `SmartClawsDeviceGroup.skills` unless an operator chooses matching names/content.

## Message Envelope

`packages/core/src/envelope.ts` defines the convention for channel payloads used by the TypeScript stack:

```json
{
  "v": 1,
  "ts": 1711324800,
  "dev": "temp-sensor",
  "topic": "temperature",
  "p": {
    "temp": 22.5
  }
}
```

Exports:

- `encode(topic, payload, deviceId, timestamp?)`
- `decode(data)`

The contracts store opaque bytes and do not enforce this schema. The CLI, dashboard, tests, and skills assume this envelope format.

## TypeScript Core Package

Package: `@smartclaws/core`

Path: `packages/core`

Exports:

- `.` -> `src/index.ts`
- `./envelope`
- `./networks`
- `./names`
- `./types`
- `./abi/*`

Important modules:

- `src/types.ts`: `Config`, `WalletFile`, `DeviceFile`.
- `src/envelope.ts`: v1 JSON envelope encode/decode.
- `src/networks.ts`: built-in SKALE Sandbox network.
- `src/names.ts`: random adjective-noun name generation.

Current built-in network:

- Key: `testnet`
- Name: `SKALE Sandbox`
- Chain id: `196243392`
- RPC: `https://base-sepolia-testnet.skalenodes.com/v1/vigilant-snappy-arcturus`
- Explorer: `https://vigilant-snappy-arcturus.base-sepolia-testnet-explorer.skalenodes.com`
- Registry: `0x18B62f70ddaA2666FA5933a7b6Ff3943e69ca690`
- Native currency: `CREDITS`

ABI artifacts live in `packages/core/abi` and are exported by `smart-contracts/scripts/export-abi.sh`.

## CLI Package

Package: `@smartclaws/cli`

Path: `packages/cli`

Runtime dependencies:

- `@smartclaws/core`
- `commander`
- `viem`

Scripts:

- `bun run dev`
- `bun run build`
- `bun run check`
- `bun run lint`
- `bun run lint:fix`
- `bun test`
- `bun run test:unit`
- `bun run test:integration`

The CLI entrypoint is `packages/cli/src/index.ts`.

### CLI Commands

`smartclaws init`

- Creates config and local directories under `SMARTCLAWS_HOME` or `~/.smartclaws`.
- Writes `config.json` if missing.
- Creates `wallets/` and `devices/`.
- Generates `wallets/default.json` if missing.
- Supports `--network`, `--rpc-url`, `--chain-id`, and `--contract`.

`smartclaws wallet info`

- Prints the local wallet address.
- Fetches and prints balance if RPC is configured.

`smartclaws register`

- Registers a new device group on the configured registry.
- Options: `--name`, `--skills`.
- Uses a random adjective-noun group name when `--name` is omitted.
- Saves the resulting group address as `deviceGroupAddress` in config.
- Enforces one configured device group per machine/config.

`smartclaws device register --name <name>`

- Registers a device in the configured device group.
- Option: `--capacity <bytes>`, default `1048576`.
- Uses the local wallet address as `devicePublisher`.
- Reads the new device's incoming/outgoing channels.
- Saves local device metadata under `~/.smartclaws/devices/<name>.json`.

`smartclaws device list`

- Lists locally saved device records.

`smartclaws publish --device <name> --topic <topic> --data <json>`

- Loads the local device record.
- Parses `--data` as JSON.
- Encodes a SmartClaws envelope using the device name as `dev`.
- Publishes to the device outgoing channel with `publishMessage`.
- Waits for the transaction receipt.

`smartclaws read`

- Reads messages from a local device outgoing channel or a direct channel address.
- Options:
  - `--device <name>`
  - `--channel <address>`
  - `--limit <n>`
  - `--offset <n>`
  - `--raw`
  - `--json`
- Defaults to recent messages.
- Decodes envelopes unless `--raw` is used.

### CLI Data Files

Config file:

```json
{
  "version": 1,
  "network": "testnet",
  "chainId": 196243392,
  "rpcUrl": "https://...",
  "contractAddress": "0x...",
  "deviceGroupAddress": "0x..."
}
```

Wallet file:

```json
{
  "address": "0x...",
  "privateKey": "0x..."
}
```

Device file:

```json
{
  "name": "temp-sensor",
  "deviceContract": "0x...",
  "incomingChannel": "0x...",
  "outgoingChannel": "0x..."
}
```

### CLI Implementation Notes

- `packages/cli/src/contracts.ts` builds viem public/wallet clients and contract wrappers for registry, device group, device, and channel.
- `packages/cli/src/client.ts` provides a read-only public client for wallet balance.
- `packages/cli/src/device.ts` handles local device JSON files.
- `smartclaws read --channel` still requires a wallet file because the command currently calls `loadWallet()`, even though channel reads are public.

## Device Flow

A current end-to-end producer flow is:

1. `smartclaws init`
2. Fund the generated wallet with CREDITS/sFUEL as required by the target SKALE chain.
3. `smartclaws register --name <group> --skills <comma-separated-skills>`
4. `smartclaws device register --name <device>`
5. `smartclaws publish --device <device> --topic <topic> --data '<json>'`
6. `smartclaws read --device <device> --limit 5`

The device's outgoing channel is the primary telemetry stream. The incoming channel exists on-chain, but there is no CLI command yet for sending commands to a device incoming channel or for a device process to read commands from it.

## Reader Flow

A current reader flow is:

1. `smartclaws init`
2. Obtain the producer's outgoing channel address.
3. `smartclaws read --channel <address> --limit 20 --json`

If the same machine registered the device, the reader can use:

```bash
smartclaws read --device temp-sensor --limit 20 --json
```

The reader skill says the wallet does not need funds for read-only use, which is conceptually true, but the current CLI still requires a generated wallet file.

## Dashboard

Package: `@smartclaws/dashboard`

Path: `packages/dashboard`

Stack:

- Vite
- React 19
- TypeScript
- Tailwind 4
- wagmi
- viem
- TanStack Query
- Recharts
- lucide-react
- sonner
- shadcn-style component setup

Configuration:

- `VITE_NETWORK`
- `VITE_RPC_URL`
- `VITE_CHAIN_ID`
- `VITE_REGISTRY_ADDRESS`

If env vars are omitted, dashboard uses `@smartclaws/core/networks` defaults.

Routes:

- `/`: landing page with setup prompts for agents.
- `/overview`: device group, agent, and channel counts.
- `/groups`: registered device groups with name, status, skills chips, and device count.
- `/groups/:address`: group detail, owner, devices, skills tab.
- `/devices/:address`: device detail with incoming/outgoing channel tabs.
- `/channels/:address`: direct channel viewer.
- `/agents`: placeholder.
- `/skills`: placeholder.
- `/setup`: automatic/manual setup instructions.

Read hooks:

- `useRegistryStats`: registry counts.
- `useDeviceGroups`: registry group list and per-group metadata.
- `useGroupDetail`: group metadata, devices, latest outgoing message timestamp and device name.
- `useDeviceDetail`: device channels, publisher, group.
- `useChannelMessages`: channel stats, batch reads, decoding, pagination.
- `useChartData`: numeric payload fields to chart series.

Dashboard channel UI:

- Message count.
- Storage used.
- Capacity percentage.
- Sensor charts for numeric payload fields.
- Text cards for non-numeric latest payload fields.
- Expandable decoded JSON table.
- Raw/decode-error fallback display.

Important dashboard limitations:

- It is read-only.
- There are no wallet connectors or write flows.
- Agent and global skills pages are placeholders.
- There are no dashboard tests.

## Agent Skills

Skills live under `skills/`.

### `smartclaws-producer`

Path: `skills/smartclaws-producer/SKILL.md`

Purpose: guide an AI agent through installing the CLI, initializing SmartClaws, funding the wallet, registering a device group, registering devices, writing sensor scripts, and publishing data on-chain.

Important rules:

- Assume real hardware when users ask to set up a sensor unless they explicitly ask for a mock or simulation.
- Ask for exact sensor model and connection method before writing real hardware publisher scripts.
- Do not generate fake sensor data for a real setup request.
- Save scripts to `~/.smartclaws/scripts/<device-name>-publisher.py`.
- Use `smartclaws publish` from scripts.

Examples:

- `skills/smartclaws-producer/examples/ble-publisher.py`
- `skills/smartclaws-producer/examples/mock-publisher.py`

### `smartclaws-reader`

Path: `skills/smartclaws-reader/SKILL.md`

Purpose: guide an AI agent through reading and analyzing SmartClaws sensor data from a channel or local device.

It documents:

- `smartclaws read --channel <address> --limit <n> --json`
- reading from offsets
- human-readable output
- JSON output schema
- current value, averages, threshold checks, trend analysis
- filtering by `dev` and `topic`
- honesty about simulated/mock data

## Python Package And Scripts

Package: `smartclaws`

Path: `python`

Declared dependencies:

- `web3>=7.10`
- `click>=8.1`
- `bleak>=3.0.1`

The Python package has:

- `src/smartclaws/__init__.py`: docstring only.
- `src/smartclaws/cli/main.py`: empty Click group.

The Python package does not implement the CLI commands described by the skills. Those commands are provided by the TypeScript/Bun CLI binary.

Python scripts:

- `python/scripts/scan.py`: scan for BLE devices whose name contains `LYWSD03`.
- `python/scripts/read.py`: developer scratch script for reading a hard-coded LYWSD03 BLE address.
- `python/scripts/ble_publisher.py`: reads LYWSD03 BLE data and publishes through `/usr/local/bin/smartclaws`.

BLE parsing:

- Characteristic: `ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6`
- bytes 0-1: signed little-endian temperature divided by 100
- byte 2: humidity percentage
- bytes 3-4: voltage divided by 1000

Python gaps:

- No Python tests.
- Python CLI is still a scaffold.
- `python/scripts/read.py` has a hard-coded address and active `asyncio.run(...)` call.
- `python/scripts/ble_publisher.py` hard-codes `/usr/local/bin/smartclaws`; the skill example uses `smartclaws` on PATH.

## Smart Contract Build And Deployment

Hardhat config:

- Solidity `0.8.28`
- Optimizer enabled, 200 runs
- EVM version `shanghai`
- Hardhat 3 ESM config
- Optional `skaleTestnet` network when `SKALE_RPC_URL` is set
- Chain id `196243392`
- Blockscout-style explorer configured through chain descriptors
- Verify API key set to `"empty"`

Contract package scripts:

- `compile`
- `test`
- `lint`
- `verify`

Deploy script:

- `smart-contracts/scripts/deploy.ts`
- Deploys `SmartClaws`
- Creates one demo channel with 1 MiB capacity for deployer
- Attempts Blockscout verification of registry and the demo channel

Verify script:

- `smart-contracts/scripts/verify.ts`
- Uses env vars:
  - `VERIFY_ADDRESS`
  - `VERIFY_ARGS`
  - `VERIFY_CONTRACT`

ABI export:

- `smart-contracts/scripts/export-abi.sh`
- Writes ABI + bytecode JSON to `packages/core/abi`

## Tests

Contract tests:

- `smart-contracts/test/SmartClawsChannel.test.ts`
- Covers channel publish/read, authorized publisher, unauthorized rejection, empty payload rejection, offsets, batch reads, pruning, and disabled writes.

CLI unit tests:

- `packages/cli/tests/unit/envelope.test.ts`
- `packages/cli/tests/unit/config.test.ts`
- `packages/cli/tests/unit/wallet.test.ts`
- `packages/cli/tests/unit/names.test.ts`

CLI integration tests:

- `packages/cli/tests/integration/channel.test.ts`
- `packages/cli/tests/integration/register-device.test.ts`
- `packages/cli/tests/integration/e2e-flow.test.ts`
- `packages/cli/tests/integration/wallet-balance.test.ts`

Integration tests use Anvil at `http://127.0.0.1:8545` and deploy registry bytecode from `@smartclaws/core/abi/SmartClaws.json`.

Notable test gaps:

- No Hardhat tests for registry/device group/device/agent lifecycle beyond TypeScript integration coverage.
- No dashboard tests.
- No Python tests.
- No direct CLI tests for command process behavior are apparent; integration tests exercise the underlying viem flows.

## CI And Release

Workflows live under `.github/workflows`.

`smart-contracts.yml`:

- Runs on `smart-contracts/**`.
- Uses Node 22 and Bun.
- Installs dependencies.
- Compiles contracts.
- Runs solhint.
- Runs Hardhat tests.

`typescript.yml`:

- Runs on `packages/**` and `smart-contracts/contracts/**`.
- Checks out submodules.
- Installs/compiles contracts.
- Exports ABIs.
- Runs root `bun install`.
- Lints `packages/cli`.
- Type checks `packages/core`.
- Type checks `packages/cli`.
- Runs CLI unit tests.
- Starts Anvil with `scripts/anvil.sh`.
- Runs CLI integration tests.

`release.yml`:

- Runs on every push to `main`.
- Computes tag `v<version>-<branch>.<index>`.
- Builds CLI binaries for:
  - `darwin-arm64`
  - `linux-x86_64`
  - `linux-arm64`
- Pushes a git tag.
- Creates a GitHub release with binaries.

CI gaps:

- Dashboard is not typechecked, linted, or built in the main TypeScript workflow.
- Python is not tested/linted in CI.
- No lockfile is tracked because `.gitignore` ignores `bun.lock`.

## Root Scripts

Root `package.json` scripts:

- `compile`: Hardhat compile.
- `export-abi`: compile and export ABIs.
- `test:contracts`: Hardhat tests.
- `test:cli`: CLI tests.
- `lint`: Biome check on CLI and dashboard src.
- `build:cli`: build CLI binary.
- `build:dashboard`: dashboard build.
- `dev:dashboard`: dashboard dev server.
- `version:check`: verify version consistency.
- `version:bump`: update root, packages, contracts, and Python versions.

Repo scripts:

- `scripts/anvil.sh`: starts Anvil in Docker and prints `ANVIL_PRIVATE_KEY`.
- `scripts/version-check.mjs`: checks version consistency across packages.
- `scripts/version-bump.mjs`: writes a new version across packages and Python pyproject.

## Helper Scripts

`helper-scripts` contains SKALE operational tooling:

- `deploy_manager.sh`
- `deploy_ima.sh`
- `deploy_allocator.sh`
- `deploy_fair.sh`
- `helper.sh`
- `build_and_publish.sh`
- `calculate_version.sh`
- `create_universal_abi_file.py`
- `upload_to_do.py`
- `ssl_check.py`
- `fix_filebeat_config.py`
- `redis/run.sh`
- `redis/conf/redis.conf`

The old `.gitmodules` file is not present in the current checkout, but the helper script README still describes embedding the folder as a submodule.

Operational risks:

- Helper scripts handle private keys, Docker, deployment artifacts, and remote uploads.
- `scripts/anvil.sh` uses a fixed Docker container name `anvil` and `docker run ... || true`, which can hide stale container/state problems.
- `ssl_check.py` binds to `0.0.0.0` and is suitable for local checks, not production serving.

## Current Limitations And Risks

- The contracts are permissionless, so registry spam prevention is not handled on-chain.
- Channel pruning is loop-based and can be gas-heavy.
- Agent metadata is event-only.
- Agent contract flows exist, but CLI and dashboard do not expose them yet.
- Device incoming channels exist, but CLI publishing/reading focuses on outgoing telemetry.
- `smartclaws read --channel` requires local initialization and wallet file even though reads are public.
- The CLI stores private keys in plaintext JSON with file mode `0o600`.
- Dashboard is read-only and not covered by CI.
- Python package CLI is a stub while skill docs describe the TypeScript/Bun CLI.
- The Python scratch `read.py` has a hard-coded BLE address.
- `bun.lock` is ignored, reducing install reproducibility.
- Release workflow runs on every push to `main`, which can create many tags/releases.

## Useful Commands

Install workspace dependencies:

```bash
bun install
```

Build and test contracts:

```bash
bun run compile
bun run test:contracts
cd smart-contracts && bun run lint
```

Export ABIs:

```bash
bun run export-abi
```

Run CLI checks:

```bash
cd packages/cli
bun run lint
bun run check
bun run test:unit
bun run test:integration
```

Build CLI:

```bash
bun run build:cli
```

Run dashboard:

```bash
bun run dev:dashboard
```

Build dashboard:

```bash
bun run build:dashboard
```

SmartClaws producer quick start:

```bash
smartclaws init
smartclaws wallet info
smartclaws register --name my-sensors --skills temperature,humidity
smartclaws device register --name temp-sensor
smartclaws publish --device temp-sensor --topic sensor --data '{"temp":22.5,"humidity":55}'
smartclaws read --device temp-sensor --limit 5
```

SmartClaws reader quick start:

```bash
smartclaws init
smartclaws read --channel <outgoing-channel-address> --limit 20 --json
```

BLE publisher example:

```bash
python3 skills/smartclaws-producer/examples/ble-publisher.py \
  --address <BLE-MAC-or-UUID> \
  --device temp-sensor \
  --interval 60
```

## Best Next Additions

High-value next work:

- Add CLI support for `registerAgent`, agent channel discovery, and agent publish/read flows.
- Add CLI support for device incoming channels.
- Add CLI unregister commands for devices, groups, agents, and channels.
- Add Hardhat tests for registry, device group, device, and agent lifecycles.
- Add dashboard CI: typecheck, lint, build.
- Add Python CI or clarify that Python is scripts-only.
- Make `smartclaws read --channel` work without a wallet file.
- Decide whether to track a Bun lockfile for reproducibility.
- Align terminology between CREDITS and sFUEL across docs and UI.
