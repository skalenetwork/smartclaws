# SmartClaws Dev Environment Setup

SKALE Base Testnet, two-machine setup. No local node required.

```
Network      https://base-sepolia-testnet.skalenodes.com/v1/base-testnet  (chain 324705682)
Explorer     https://base-sepolia-testnet-explorer.skalenodes.com

Machine 1 — Developer    deploys contracts once, runs the dashboard
Machine 2 — OpenClaw     runs all agents (publisher + controller) and the simulator
```

**What it shows:**

- Machine 2 runs a publisher (sim or OpenClaw agent) that submits telemetry to the chain every N seconds
- Machine 2 runs a controller (OpenClaw agent) that reads that telemetry and publishes commands back
- Machine 1 opens the dashboard and watches everything happen in real time
- All data flows through the SKALE chain — both machines talk to the same public RPC

---

## Requirements

**Machine 1 (Developer):**
- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **jq** — `which jq`
- This repo cloned and checked out

**Machine 2 (OpenClaw):**
- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **Python 3.10+** — `python3 --version` (needed for simulator)
- **jq** — `which jq`
- This repo cloned and checked out to the same commit

---

## One-Time Build

Run these from the repo root on **each machine**. Repeat if you change contract or CLI code.

```bash
bun install
bun run export-abi
bun run build:cli
```

---

## Step 1 — Deploy the Registry `[Machine 1]`

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

**Copy that address.** You will use it in every `smartclaws init` call and in the dashboard.

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

## Step 2 — Start the Dashboard `[Machine 1]`

The dashboard only needs the registry address from Step 1. Start it now so you can watch
device registration, telemetry, and commands appear on-chain in real time as you complete
the remaining steps.

```bash
echo "VITE_REGISTRY_ADDRESS=$REGISTRY" > packages/dashboard/.env.local
bun run dev:dashboard
```

Open **http://localhost:5173**. Leave it open — it will update live as Machine 2 registers
devices and the agents start publishing.

> If `$REGISTRY` is not set in your shell, paste the address directly:
> `echo "VITE_REGISTRY_ADDRESS=0x<your-registry>" > packages/dashboard/.env.local`

---

## Step 3 — Publisher Setup `[Machine 2]`

### 2a. Generate and fund the publisher wallet

```bash
export SC_PUB=~/.sc-publisher

SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws init \
  --rpc-url https://base-sepolia-testnet.skalenodes.com/v1/base-testnet \
  --chain-id 324705682 \
  --contract $REGISTRY
```

Get the address and fund it with CREDITS:

```bash
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws wallet info
# Address: 0xAbC...
# Balance: 0 CREDITS  ← fund this before continuing
```

### 2b. Register device group and device

```bash
# Create the device group on-chain
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws register --name dev-shelly --skills shelly-dumb-publisher

# Register the Shelly device (deploys incoming + outgoing channels on-chain)
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws device register --name shelly-plug-s

# List the device — note the channel addresses
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws device list
```

Output:

```
shelly-plug-s
  Contract:  0x...
  Outgoing:  0x...
  Incoming:  0x...
```

Export and keep these — you will use them for Steps 3, 4, and the agent startup files:

```bash
export OUTGOING_CHANNEL=0x<outgoing-from-above>
export INCOMING_CHANNEL=0x<incoming-from-above>
```

---

## Step 4 — Controller Setup `[Machine 2]`

### 3a. Generate and fund the controller wallet

```bash
export SC_CTL=~/.sc-controller

SMARTCLAWS_HOME=$SC_CTL packages/cli/dist/smartclaws init \
  --rpc-url https://base-sepolia-testnet.skalenodes.com/v1/base-testnet \
  --chain-id 324705682 \
  --contract $REGISTRY

SMARTCLAWS_HOME=$SC_CTL packages/cli/dist/smartclaws wallet info
# Fund this address with CREDITS before continuing
```

```bash
export CONTROLLER_WALLET=0x<controller-address-from-wallet-info>
```

---

## Step 5 — Authorize the Controller `[Machine 2]`

The publisher (device group owner) must grant the controller wallet write access to the incoming
channel. Run this once:

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

## Publisher Session `[Machine 2]`

Two options depending on whether you have real hardware.

### Option A — Shelly Simulator (no hardware needed)

```bash
export SMARTCLAWS_BIN=$(pwd)/packages/cli/dist/smartclaws  # must be exported, not aliased
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

### Option B — Publisher OpenClaw agent (real Shelly on the network)

Give an existing OpenClaw operator/orchestrator agent the contents of
`dev/startup-dumb-agent.md`, filling in `<registry address>` with your deployed
registry from Step 1. That file tells the orchestrator how to create or reuse a
separate `smartclaws-shelly-publisher` agent profile, attach the Shelly
publisher skill, and start the publisher session.

The new publisher agent will discover the plug via mDNS, verify setup, and wait
for instructions.

---

## Controller Session `[Machine 2]`

Open an OpenClaw session and paste the contents of `dev/startup-smart-agent.md`, replacing the
two channel address placeholders with the values from Step 2b:

```
OUTGOING_CHANNEL = 0x<your-outgoing-channel>
INCOMING_CHANNEL = 0x<your-incoming-channel>
```

The agent will read the skill file, run the preflight check, read the latest telemetry window,
evaluate the thermal policy, and report what it found before waiting for further instructions.

### Spawning both agents from a single main agent

If you prefer to orchestrate from one session, open an OpenClaw session and give it this
instruction (fill in the channel addresses first in the startup files):

```
Read dev/startup-dumb-agent.md and follow it to create or reuse the independent Shelly publisher agent.
Read dev/startup-smart-agent.md and spawn a sub-agent for the Shelly controller.
Report when both are running.
```

### Example interactions

**Read current state:**
> "What is the device doing right now?"

The agent reads the outgoing channel, reports `output`, `apower_w`, and timestamp.

**Send a command:**
> "Turn it off."

The agent publishes `command.switch.set` `{"on": false}` to the incoming channel and reports the tx hash.

**Watch the publisher session react** — within one poll cycle you see:

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
| Telemetry publishing | Publisher session: continuous rows with `ok` |
| Data on-chain | Explorer → outgoing channel address → Internal Txns |
| Command received (sim) | Publisher session: `COMMAND received` block with the RPC call it would make |
| Switch state changed | Publisher session: next row shows `OFF` / `ON` after a command |
| Live dashboard | http://localhost:5173 on Machine 1 (started in Step 2) |

**Quick read from any shell:**

```bash
SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws read \
  --channel $OUTGOING_CHANNEL --limit 5
```

```
Messages: 18 total (offsets 0..17)
Reading: 13..17

[13] 2026-05-07T10:24:01.000Z shelly-plug-s/telemetry.switch_status {"output":true,"apower_w":852.34,...}
[14] 2026-05-07T10:24:11.000Z shelly-plug-s/telemetry.switch_status {"output":true,"apower_w":847.91,...}
...
```

**Send a command manually (no agent needed):**

```bash
SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws publish \
  --channel $INCOMING_CHANNEL \
  --from controller \
  --topic command.switch.set \
  --data '{"on": false}'
```

Then watch the publisher session.

---

## Quick Reference

### Key addresses

| Thing | How to get it |
|---|---|
| Registry | Step 1 deploy output (Machine 1) |
| Outgoing channel | `SMARTCLAWS_HOME=~/.sc-publisher packages/cli/dist/smartclaws device list` (Machine 2) |
| Incoming channel | Same |
| Controller wallet | `SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws wallet info` (Machine 2) |

Pass `OUTGOING_CHANNEL`, `INCOMING_CHANNEL` to `dev/startup-smart-agent.md` on Machine 2.
Pass `REGISTRY` to `packages/dashboard/.env.local` on Machine 1.

### Explorer links

```
Registry:         https://base-sepolia-testnet-explorer.skalenodes.com/address/<REGISTRY>
Outgoing channel: https://base-sepolia-testnet-explorer.skalenodes.com/address/<OUTGOING_CHANNEL>
Incoming channel: https://base-sepolia-testnet-explorer.skalenodes.com/address/<INCOMING_CHANNEL>
```

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
Machine 1 (Developer)                  Machine 2 (OpenClaw)
                                        Publisher session
Dashboard (http://localhost:5173)         shelly-sim.py  OR  publisher agent
      │                                        │
      │  reads via RPC                         │  smartclaws publish --device
      │                                        ▼
      └──────────── [outgoing channel on SKALE Base Testnet] ──── read ──▶
                                                                           │
                                        Controller session                 │
                                          OpenClaw agent  ◀────────────────┘
                                               │
                    [incoming channel on SKALE Base Testnet] ◀──── write ──┘
                                               │
                         Publisher session polls this and logs what it
                         would call on real hardware (or calls it directly)
```

- Outgoing channel: `telemetry.switch_status` envelopes, published by the publisher session
- Incoming channel: `command.switch.set` envelopes, published by the controller session
- Both are append-only on-chain logs; anyone with the address can read, only authorized wallets can write
- No private keys leave Machine 2; Machine 1 only reads from the chain
