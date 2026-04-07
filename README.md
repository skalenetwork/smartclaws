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

## Skills

| Skill | Path | Description |
|-------|------|-------------|
| `smartclaws-producer` | `skills/smartclaws-producer` | Set up sensors and publish data on-chain |
| `smartclaws-reader` | `skills/smartclaws-reader` | Read and analyze on-chain sensor data |

## Quick Start

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

## Installing Skills

### Via npx (Claude Code, Codex, and other agents)

```bash
npx skills add skalenetwork/smartclaws
```

### Via ClawHub (OpenClaw agents)

```bash
clawhub skill install smartclaws-producer
clawhub skill install smartclaws-reader
```

### From source

```bash
git clone https://github.com/skalenetwork/smartclaws.git
cd smartclaws

# Copy skills into your OpenClaw workspace
cp -r skills/smartclaws-producer ~/.openclaw/skills/
cp -r skills/smartclaws-reader ~/.openclaw/skills/
```

Skills are plain directories containing a `SKILL.md` file following the [Agent Skills](https://agentskills.io) standard. They work with any compatible agent platform.

## Publishing Skills to ClawHub

To publish or update skills on [ClawHub](https://clawhub.ai), use the `clawhub` CLI:

### First-time setup

```bash
# Authenticate with ClawHub
clawhub auth login
```

### Publish a skill

```bash
# From the repo root — publish each skill directory
clawhub skill publish skills/smartclaws-producer
clawhub skill publish skills/smartclaws-reader
```

This reads the `SKILL.md` frontmatter (`name`, `description`, `metadata`) and uploads the skill to ClawHub under your account.

### Update an existing skill

```bash
# Bump the version or edit the SKILL.md, then re-publish
clawhub skill publish skills/smartclaws-producer
```

Re-publishing an existing skill name updates it in-place on ClawHub.

### Verify the listing

```bash
# Check that your skills are live
clawhub skill info smartclaws-producer
clawhub skill info smartclaws-reader
```

Or browse directly at:
- https://clawhub.ai/skills/smartclaws-producer
- https://clawhub.ai/skills/smartclaws-reader

### Install from ClawHub (for users)

```bash
clawhub skill install smartclaws-producer
clawhub skill install smartclaws-reader
```

This downloads the skill into `~/.openclaw/skills/` automatically.

## Development

```bash
# Install dependencies
bun install

# Build CLI
cd packages/cli && bun run build

# Run smart contract tests
cd smart-contracts && bun run test

# Python SDK
cd python && pip install -e .
```

## License

LGPL-3.0-or-later
