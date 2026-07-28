# SmartClaws

SmartClaws is an on-chain IoT messaging stack for SKALE. It gives devices,
controllers, and OpenClaw agents shared append-only message channels with
explicit on-chain roles for publishing telemetry, sending commands, and logging
agent decisions.

The project includes Solidity contracts, a TypeScript CLI and SDK, an OpenClaw
plugin, operational skills, and a small set of hardware/simulation scripts.

## How It Fits

SmartClaws models an IoT deployment as a few durable on-chain objects:

| Object | Purpose |
| --- | --- |
| Registry | Deploys and indexes channels, device groups, devices, and agents. |
| Device group | Owns a set of devices and can manage device role grants. |
| Device | Has an outgoing telemetry channel and an incoming command channel. |
| Agent | Has an outgoing decision/audit channel and an incoming notification channel. |
| Channel | Append-only message log storing encoded SmartClaws envelopes. |

Messages use a compact envelope shape:

```json
{
  "v": 1,
  "ts": 1770000000,
  "dev": "device-or-agent-id",
  "topic": "telemetry.temperature",
  "p": { "value": 22.5 }
}
```

## Repository Layout

| Path | Description |
| --- | --- |
| `smart-contracts/` | Hardhat 3 Solidity contracts and tests. |
| `packages/core/` | Shared TypeScript types, envelope encoding, names, network config, and ABI JSON. |
| `packages/sdk/` | TypeScript SDK for config, wallets, discovery, reads, publishes, role grants, and backups. |
| `packages/cli/` | `smartclaws` command-line binary built on the SDK. |
| `packages/openclaw-plugin/` | OpenClaw tools: wallet info, read, publish, notify. |
| `packages/dashboard/` | Frontend dashboard package. |
| `skills/` | Device contracts and operational OpenClaw skills. |
| `open-claw-setups/` | Example full agent workspaces/templates. |
| `dev/` | Local hardware/simulation helpers, not required for the core protocol. |
| `python/` | Experimental Python utilities. |

## Quick Start

From a fresh checkout:

```bash
bun install
bun run build:packages
bun run build:cli
```

Use the built CLI directly:

```bash
packages/cli/dist/smartclaws --version
```

Initialize a SmartClaws home, create a wallet/config, and register a group and
device:

```bash
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws init --network base-testnet
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws wallet info

# Fund the printed wallet address with sFUEL/CREDITS before sending txs.
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws register --name demo-group
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws device register --name temp-sensor
```

Publish and read telemetry:

```bash
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws publish \
  --device temp-sensor \
  --topic telemetry.temperature \
  --data '{"temperature_c":22.5}'

SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws read \
  --device temp-sensor \
  --limit 5
```

## Agents And Roles

Devices and agents publish through their own contracts rather than writing to
their channels directly. This keeps ownership and authorization enforced
on-chain.

Device roles:

| Role | Allows |
| --- | --- |
| `publisher` | Publish telemetry to the device outgoing channel. |
| `master` | Publish commands to the device incoming channel. |

Agent roles:

| Role | Allows |
| --- | --- |
| `publisher` | Publish decision/audit messages to the agent outgoing channel. |
| `sender` | Notify the agent by publishing to its incoming channel. |
| `agent-admin` | Manage agent publisher/sender/admin grants. |

Register an agent and write a decision log:

```bash
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws agent register \
  --name controller-1 \
  --metadata "Demo controller"

SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws agent publish \
  --agent controller-1 \
  --topic decision.log \
  --data '{"decision":"hold","reason":"temperature is in range"}'
```

Grant another wallet permission to command a device or notify an agent:

```bash
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws device grant \
  --device temp-sensor \
  --role master \
  --account <controller-wallet-address>

SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws agent grant \
  --agent controller-1 \
  --role sender \
  --account <other-agent-wallet-address>
```

## OpenClaw Plugin

The OpenClaw plugin is published by CI to ClawHub as
`smartclaws-openclaw-plugin`. It can also be installed from a local checkout
while developing.

Published install:

```bash
openclaw plugins install clawhub:smartclaws-openclaw-plugin
openclaw plugins inspect smartclaws --runtime
```

Local-source install:

```bash
bun run build:packages
openclaw plugins install ./packages/openclaw-plugin
openclaw plugins inspect smartclaws --runtime
```

Restart or reload the OpenClaw Gateway after installing or updating the plugin.
Configure it with a SmartClaws home and network:

```jsonc
{
  "smartclawsHome": "~/.smartclaws",
  "network": "base-testnet"
}
```

The plugin exposes four tools:

| Tool | Purpose |
| --- | --- |
| `smartclaws_wallet_info` | Read configured wallet address and balance. |
| `smartclaws_read` | Read and decode messages from device or channel targets. |
| `smartclaws_publish` | Publish device telemetry, agent outbound logs, or direct channel envelopes. |
| `smartclaws_notify` | Publish to another agent's incoming channel. |

Write tools are optional and must be explicitly enabled in the OpenClaw
configuration before an agent can call them.

## Skills

Skills are published by CI to ClawHub from the `skills/` directory. Install them
by slug:

```bash
clawhub install smartclaws
clawhub install smartclaws-master-agent
clawhub install smartclaws-bridge-agent
clawhub install smartclaws-device-shelly-plug-s-gen3
clawhub install smartclaws-device-novapm-sds011
clawhub install nearai-verify
```

Use `smartclaws` first for onboarding. Then install one role skill
(`smartclaws-master-agent` or `smartclaws-bridge-agent`) and one device contract
skill for every device the agent reads or commands.

The same skills are available in the repo for local development:

| Path | Contents |
| --- | --- |
| `skills/smartclaws/` | Onboarding/setup guidance and workspace templates. |
| `skills/operational/` | Master-agent and bridge-agent operating procedures. |
| `skills/devices/` | Device-specific contracts, topics, payloads, and safety rules. |
| `open-claw-setups/` | Example complete agent workspaces. |

The current operational pattern is:

1. Use `skills/smartclaws/` to create a `SMARTCLAWS.md` wiring file.
2. Add the relevant device skill from `skills/devices/`.
3. Use `smartclaws-bridge-agent` for hardware/API telemetry bridges.
4. Use `smartclaws-master-agent` for control decisions and on-chain audit logs.

## Development Scripts

The `dev/` directory contains local helpers for manual experiments:

| Script | Purpose |
| --- | --- |
| `dev/shelly-sim.py` | Simulated Shelly Plug S telemetry and command handling. |
| `dev/shelly-bridge.py` | Real Shelly Plug S Gen3 HTTP bridge. |
| `dev/find-shelly.py` | Local network discovery helper for Shelly devices. |
| `dev/thermal-sim.py` | Simulated room thermal sensor. |
| `dev/tariff-sim.py` | Simulated energy tariff file writer. |

These are not part of the protocol or release build. Treat them as examples and
manual demo aids.

## Backups And Secrets

SmartClaws homes contain wallet private keys. Do not commit them.

```bash
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws backup
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws backup list
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws backup clean --keep 3
SMARTCLAWS_HOME=~/.smartclaws packages/cli/dist/smartclaws backup restore <name>
```

Backups include the wallet file. Keep them local and do not sync or publish
`wallets/default.json`, backup archives, or `controller/wallets/` directories.

## Development

Useful commands:

```bash
bun install
bun run build:core
bun run build:sdk
bun run build:plugin
bun run build:cli
bun run build:packages

bun run test:sdk
bun run test:cli
bun run test:contracts

bun run lint
```

Contract ABI JSON in `packages/core/abi/` is generated from the Solidity build.
After contract changes, compile/export ABIs instead of editing ABI JSON by hand:

```bash
bun run export-abi
```

## License

LGPL-3.0-or-later
