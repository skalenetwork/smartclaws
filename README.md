# SmartClaws

Publish and read IoT sensor data on the [SKALE](https://skale.space) blockchain. SmartClaws provides a CLI, SDK, smart contracts, and OpenClaw agent skills for end-to-end IoT data pipelines.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@smartclaws/cli` | `packages/cli` | CLI tool for init, publish, read, device management |
| `@smartclaws/core` | `packages/core` | Shared types, envelope encoding, network config |
| `@smartclaws/dashboard` | `packages/dashboard` | Web dashboard for monitoring sensors |
| `@skalenetwork/smartclaws-contracts` | `smart-contracts` | Solidity contracts (channel, device group, agent) |
| `smartclaws` (Python) | `python` | Python SDK and CLI |

## Demo

**→ [Shelly Thermal Demo Setup](dev/demo-shelly-thermal-setup.md)**

End-to-end demo with a real Shelly Plug S, thermal simulator, energy tariff simulator, and an OpenClaw master agent that controls the relay on-chain to balance comfort and energy cost.

## Quick Start

> **Note:** Pre-built binaries are published from the `main` branch. If you are on `develop` or want the latest code, build from source (see [Development](#development)).

```bash
# Install the CLI
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# On Apple Silicon, Rosetta shells can report x86_64. Prefer real hardware arch.
if [ "$OS" = "darwin" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ARCH="arm64"
fi

case "$ARCH" in
  aarch64|arm64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x86_64" ;;
esac

PLATFORM="${OS}-${ARCH}"
curl -fL -o /usr/local/bin/smartclaws \
  "https://github.com/skalenetwork/smartclaws/releases/latest/download/smartclaws-${PLATFORM}"
chmod +x /usr/local/bin/smartclaws

# Initialize
smartclaws init
smartclaws wallet info
# Fund the wallet with sFUEL, then:
smartclaws register
smartclaws device register --name temp-sensor

# Publish
smartclaws publish --device temp-sensor --topic temperature --data '{"temp": 22.5}'

# Read
smartclaws read --device temp-sensor --limit 5
```

## Skills

> **⚠️ Under maintenance.**
>
> The skills live in this repo under `skills/` (general-purpose producer/reader) and `open-claw-setups/` (full agent workspaces). ClawHub publishing, `npx skills add`, and registry installation are not operational yet.
>
> To use the skills today, copy them directly from the repo into your agent workspace — see the [Demo Setup](dev/demo-shelly-thermal-setup.md) for a working example.

| Skill | Path | Description |
|-------|------|-------------|
| `smartclaws-producer` | `skills/smartclaws-producer` | Set up sensors and publish data on-chain |
| `smartclaws-reader` | `skills/smartclaws-reader` | Read and analyze on-chain sensor data |
| `smartclaws-shelly-plug-s-gen3` | `skills/smartclaws-shelly-plug-s-gen3` | Shelly Plug S Gen3 specific skills |
| Shelly master agent workspace | `open-claw-setups/shelly-master-1/` | Full OpenClaw agent setup for energy-flex control |

## Development

```bash
# Install dependencies
bun install

# Build CLI
bun run build:cli

# Run smart contract tests
cd smart-contracts && bun run test

# Python SDK
cd python && pip install -e .
```

## License

LGPL-3.0-or-later
