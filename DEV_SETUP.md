# SmartClaws Dev Environment Setup

SKALE Base Testnet, two-machine setup. No local node required.

```
Network      https://base-sepolia-testnet.skalenodes.com/v1/base-testnet  (chain 324705682)
Explorer     https://base-sepolia-testnet-explorer.skalenodes.com

Publisher machine   Terminal 1 — Shelly simulator (always running)
Controller machine  Terminal 2 — Claude Code / OpenClaw session (interactive)
```

**What it shows:**

- Terminal 1 prints a live telemetry stream (power, voltage, switch state) and submits each reading to the chain
- Terminal 2 can read that telemetry from the blockchain and publish commands back to the device
- When a command arrives on-chain, Terminal 1 logs exactly what it would call on real Shelly hardware
- All data flows through the SKALE chain — both machines talk to the same public RPC

---

## Requirements

Both machines need:

- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **Python 3.10+** — `python3 --version`
- **jq** — used by the ABI export script (`which jq`)
- This repo cloned and checked out to the same commit

---

## One-Time Build (both machines)

Run these from the repo root on **each machine**. Repeat if you change contract or CLI code.

```bash
bun install
bun run export-abi
bun run build:cli
```

Add a shell alias so the CLI is available without its full path:

```bash
alias smartclaws="$(pwd)/packages/cli/dist/smartclaws"
```

---

## Step 1 — Deploy the Registry (publisher machine, once)

The SmartClaws registry contract must be deployed to the SKALE Base Testnet before anything else.
You need a funded deployer wallet (CREDITS for gas).

```bash
export SKALE_RPC_URL=https://base-sepolia-testnet.skalenodes.com/v1/base-testnet
export SKALE_CHAIN_ID=324705682
export DEPLOYER_PRIVATE_KEY=0x<your-funded-deployer-private-key>

cd smart-contracts
bunx hardhat run scripts/deploy.ts --network skaleTestnet
```

Look for this line in the output:

```
SmartClaws registry deployed to: 0x...
```

**Copy that address.** You will use it in every `smartclaws init` call on both machines.

```bash
export REGISTRY=0x<registry-address-from-above>
```

> Verify the deployment in the explorer:
> https://base-sepolia-testnet-explorer.skalenodes.com/address/<REGISTRY>

After deployment, update `packages/core/src/networks.ts` so future `smartclaws init --network base-testnet` calls pick up the registry automatically (optional, but convenient):

```ts
// In the "base-testnet" entry, set:
registryAddress: "0x<your-deployed-registry>",
```

Then rebuild the CLI: `bun run build:cli`

---

## Step 2 — Publisher Machine Setup

### 2a. Generate and fund the publisher wallet

```bash
alias smartclaws="$(pwd)/packages/cli/dist/smartclaws"
export SC_PUB=~/.sc-publisher

SMARTCLAWS_HOME=$SC_PUB smartclaws init \
  --rpc-url https://base-sepolia-testnet.skalenodes.com/v1/base-testnet \
  --chain-id 324705682 \
  --contract $REGISTRY
```

This creates `$SC_PUB/wallets/default.json` with a new key pair. Get the address:

```bash
SMARTCLAWS_HOME=$SC_PUB smartclaws wallet info
```

Output:

```
Address: 0xAbC...
Balance: 0 CREDITS
```

**Fund this address with CREDITS** from your faucet or another wallet before continuing.

Then verify:

```bash
SMARTCLAWS_HOME=$SC_PUB smartclaws wallet info
# Balance should now be > 0
```

### 2b. Register device group and device

```bash
# Create the device group on-chain
SMARTCLAWS_HOME=$SC_PUB smartclaws register --name dev-shelly --skills shelly-dumb-publisher

# Register the Shelly device (deploys incoming + outgoing channels on-chain)
SMARTCLAWS_HOME=$SC_PUB smartclaws device register --name shelly-plug-s

# List the device — note the channel addresses
SMARTCLAWS_HOME=$SC_PUB smartclaws device list
```

The device list output looks like:

```
shelly-plug-s
  Contract:  0x...
  Outgoing:  0x...
  Incoming:  0x...
```

Export these — you will use them for the rest of the session and share them with the controller:

```bash
export OUTGOING_CHANNEL=0x<outgoing-from-above>
export INCOMING_CHANNEL=0x<incoming-from-above>
```

---

## Step 3 — Controller Machine Setup

Do this on the **controller machine** (or the same machine if testing locally with two terminals).

### 3a. Generate and fund the controller wallet

```bash
alias smartclaws="$(pwd)/packages/cli/dist/smartclaws"
export SC_CTL=~/.sc-controller

SMARTCLAWS_HOME=$SC_CTL smartclaws init \
  --rpc-url https://base-sepolia-testnet.skalenodes.com/v1/base-testnet \
  --chain-id 324705682 \
  --contract $REGISTRY

SMARTCLAWS_HOME=$SC_CTL smartclaws wallet info
```

**Fund this address with CREDITS** before continuing (needs gas to publish commands).

```bash
export CONTROLLER_WALLET=0x<controller-address-from-wallet-info>
```

---

## Step 4 — Authorize the Controller (publisher machine)

The device incoming channel is owned by the device group contract. The publisher (group owner) must
explicitly grant the controller wallet write access to it. Run this **once** from the publisher machine:

```bash
SMARTCLAWS_HOME=$SC_PUB bun dev/authorize-controller.ts shelly-plug-s $CONTROLLER_WALLET
```

Expected output:

```
Publisher config:  /home/you/.sc-publisher
Device group:      0x...
Device contract:   0x...
Incoming channel:  0x...
Granting access to: 0x...

Done. Tx: 0x...
Status: success

The controller wallet can now publish to:
  0x<INCOMING_CHANNEL>
```

> Verify the transaction in the explorer:
> https://base-sepolia-testnet-explorer.skalenodes.com/tx/<tx-hash>

---

## Terminal 1 — Publisher (Shelly Simulator)

On the **publisher machine**, open a terminal and set your env vars:

```bash
alias smartclaws="$(pwd)/packages/cli/dist/smartclaws"

export SMARTCLAWS_HOME=~/.sc-publisher
export DEVICE_NAME=shelly-plug-s
export INCOMING_CHANNEL=0x<your-incoming-channel>
export POLL_SECONDS=10

python3 dev/shelly-sim.py
```

You should see a live stream:

```
============================================================
  Shelly Plug S Gen3 Simulator
============================================================
  Device:   shelly-plug-s
  Incoming: 0x...
  Interval: 10s
  Switch:   ON
============================================================

[10:24:01] #0001 | ON  |  852.34 W | 230.1 V | 3.704 A | ok
[10:24:11] #0002 | ON  |  847.91 W | 229.8 V | 3.690 A | ok
[10:24:21] #0003 | ON  |  861.22 W | 230.3 V | 3.741 A | ok
```

Each row is one telemetry message published to the outgoing channel on SKALE.

> Watch it appear in the explorer (after a few seconds):
> https://base-sepolia-testnet-explorer.skalenodes.com/address/<OUTGOING_CHANNEL>

Leave this running.

---

## Terminal 2 — Controller Agent (controller machine)

On the **controller machine**, open a Claude Code or OpenClaw session:

```bash
claude
```

Paste the following context block to give the agent everything it needs. Replace the channel
addresses with yours from Step 2b:

```
You are acting as the SmartClaws controller for a Shelly Plug S Gen3 device.

Your skill: skills/smartclaws-shelly-reader/SKILL.md

Your environment:
  SMARTCLAWS_HOME = ~/.sc-controller
  CLI binary      = packages/cli/dist/smartclaws  (or `smartclaws` if aliased)
  OUTGOING_CHANNEL = 0x<your-outgoing-channel>
  INCOMING_CHANNEL = 0x<your-incoming-channel>

To read telemetry:
  SMARTCLAWS_HOME=~/.sc-controller smartclaws read \
    --channel 0x<OUTGOING_CHANNEL> --limit 10 --json

To send a command to the device:
  SMARTCLAWS_HOME=~/.sc-controller smartclaws publish \
    --channel 0x<INCOMING_CHANNEL> \
    --from controller \
    --topic command.switch.set \
    --data '{"on": true, "toggle_after": 0}'

When I ask a question about the device, read fresh telemetry first.
When I give an instruction ("turn it off", "set a 60s timer"), publish the appropriate command.
Always show the on-chain data you read and confirm what you sent.
```

### Example interactions

**Read current state:**
> "What is the device doing right now?"

Claude reads the outgoing channel, reports `output`, `apower_w`, and timestamp.

**Send a command:**
> "Turn it off."

Claude publishes `command.switch.set` `{"on": false}` to the incoming channel and reports the tx hash.

**Watch Terminal 1 react** — within one poll cycle you see:

```
  ┌─ COMMAND received [offset 0] from 'controller'
  │  topic: command.switch.set
  │  payload: {"on": false}
  │  → Would call: GET http://<SHELLY_HOST>/rpc/Switch.Set?id=0&on=false
  └─ [SIM] Relay is now OFF 🔴

[10:25:31] #0010 | OFF |    0.31 W | 230.0 V | 0.001 A | ok
```

---

## How to Verify It's Working

| What to check | Where to look |
|---|---|
| Telemetry publishing | Terminal 1: continuous rows with `ok` |
| Data on-chain | Explorer → outgoing channel address → Internal Txns |
| Command received by sim | Terminal 1: `COMMAND received` block with the RPC call it would make |
| Switch state changed | Terminal 1: next row shows `OFF` / `ON` after a command |

**Quick read from any shell on any machine:**

```bash
SMARTCLAWS_HOME=~/.sc-controller smartclaws read \
  --channel $OUTGOING_CHANNEL --limit 5
```

```
Messages: 18 total (offsets 0..17)
Reading: 13..17

[13] 2026-05-07T10:24:01.000Z shelly-plug-s/telemetry.switch_status {"output":true,"apower_w":852.34,...}
[14] 2026-05-07T10:24:11.000Z shelly-plug-s/telemetry.switch_status {"output":true,"apower_w":847.91,...}
...
```

**Send a command manually (no Claude needed):**

```bash
SMARTCLAWS_HOME=~/.sc-controller smartclaws publish \
  --channel $INCOMING_CHANNEL \
  --from controller \
  --topic command.switch.set \
  --data '{"on": false}'
```

Then watch Terminal 1.

---

## Quick Reference

### Key addresses

| Thing | How to get it |
|---|---|
| Registry | Step 1 deploy output |
| Outgoing channel | `SMARTCLAWS_HOME=~/.sc-publisher smartclaws device list` |
| Incoming channel | Same |
| Controller wallet | `SMARTCLAWS_HOME=~/.sc-controller smartclaws wallet info` |

### Explorer links

```
Registry:         https://base-sepolia-testnet-explorer.skalenodes.com/address/<REGISTRY>
Outgoing channel: https://base-sepolia-testnet-explorer.skalenodes.com/address/<OUTGOING_CHANNEL>
Incoming channel: https://base-sepolia-testnet-explorer.skalenodes.com/address/<INCOMING_CHANNEL>
```

### Share channel addresses with the controller machine

After Step 2, you only need to share two values across machines:

```
OUTGOING_CHANNEL=0x...
INCOMING_CHANNEL=0x...
REGISTRY=0x...
```

No private keys leave the publisher machine.

### Simulator state

The sim persists switch state and last command offset in `~/.sc-publisher/shelly-sim.state.json`.
To reset everything:

```bash
rm ~/.sc-publisher/shelly-sim.state.json
```

### Rebuild after code changes

```bash
bun run export-abi   # only needed after contract changes
bun run build:cli
```

---

## How It's Wired

```
Publisher machine                       Controller machine
dev/shelly-sim.py                       Claude / OpenClaw
      │                                        │
      │  smartclaws publish --device           │  smartclaws read --channel OUTGOING
      ▼                                        ▼
[outgoing channel on SKALE Base Testnet] ──────────────────────── read ──▶

      │  smartclaws read --channel INCOMING    │  smartclaws publish --channel INCOMING
      ▼                                        ▼
[incoming channel on SKALE Base Testnet] ◀─────────────────────── write ──

      │
      │  "Would call GET /rpc/Switch.Set?id=0&on=false"
      ▼
  (logged to Terminal 1, no real hardware needed)
```

- Outgoing channel: `telemetry.switch_status` envelopes, published by the sim every N seconds
- Incoming channel: `command.switch.set` envelopes, published by the controller
- Both are append-only on-chain logs; anyone with the address can read, only authorized wallets can write
- The sim polls incoming every cycle and logs what it would do on real hardware
