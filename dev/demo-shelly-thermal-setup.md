# SmartClaws — Shelly Thermal Demo Setup

This will guide you through the setup of the demo. We will have:
1. Shelly-s3 device, real, conected to LAN.
2. Simulated publisher agent (python script) which will automaticaly: read telemetry from shelly, publish telemetry, apply commands from the blockchain. NOTE: it's possible to run this as a separate agent as well - this is for simplicity.
3. Thermal simulator (python script): reads and publishes telemetry of the thermal sensor. It simulates temperature drops when shelly is off, and increases if shelly is on. Simulates the heating of a room if a heater was plugged in to shelly smart-plug
4. Tariff simulator (python script): Writes to a local file simulated data about the current price of energy. Could be fetched remotely, but more moving parts, dependency on network, api limits, etc - simulated for simplicity
5. OpenClaw master agent: complete setup of master agent, which will handle orchestration of all moving parts, and who will control shelly through the blockchain in order to maintain comfort while saving energy.

Blockchain:
```
Network   SKALE Base Testnet  (chain 324705682)
Explorer  https://base-sepolia-testnet-explorer.skalenodes.com
```

> Setup will be done for a single machine. This can be finetuned - TBD

---

## 1. Install everything

### Requirements

| Tool | Version | Install |
|---|---|---|
| **Bun** | latest | `curl -fsSL https://bun.sh/install \| bash` |
| **Python** | 3.11+ | `python3 --version` (needed for the simulators) |
| **OpenClaw** | latest | follow the [OpenClaw install guide](https://openclaw.ai/docs/install) |

Verify before continuing:

```bash
bun --version
python3 --version
openclaw --version
```
From the repo root:

```bash
bun install
```

This installs all workspace packages (`@smartclaws/cli`, `@smartclaws/core`, `@smartclaws/dashboard`)
and the `smart-contracts` sub-package in one pass.

Build the CLI binary (rebuild also after changes in the code):

```bash
bun run build:cli
```

This compiles `packages/cli/src/index.ts` into a single self-contained executable at
`packages/cli/dist/smartclaws`. Every subsequent step calls this binary directly — no global
install needed.

Verify it works:

```bash
packages/cli/dist/smartclaws --version
```

The simulator scripts (`dev/shelly-sim.py`, `dev/thermal-sim.py`, `dev/tariff-sim.py`) use only Python stdlib — no pip installs needed.

## 2. Start smart-claws on-chain

Two wallets, two roles:

| Wallet | Home dir | Role | Needs write access to |
|---|---|---|---|
| **Publisher** | `~/.sc-publisher` | Publishes telemetry for Shelly + thermal | Shelly outgoing, thermal outgoing (granted automatically on device register) |
| **Master** | `~/.sc-master` | OpenClaw controller agent | Shelly incoming only (relay commands) |

The registry is already deployed at `0xDF81Ef386fe69Cd2C4de595Af4c144CbbcB7aA49` on SKALE Base Testnet.

### 2a. Publisher wallet

```bash
SC_PUB=~/.sc-publisher

# Init — creates wallet + config
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws init --network base-testnet

# Get the address and fund it with sFUEL
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws wallet info
```

Fund the address shown before continuing. On base-testnet, even 0.5 Credits is more than enough.

```bash
# Register the device group (chose your name)
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws register --name name-example

# Register both devices — channels are deployed on-chain, publisher wallet gets write access to outgoing channels automatically
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws device register --name shelly-plug-s
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws device register --name thermal-sensor

# List devices and note the channel addresses
SMARTCLAWS_HOME=$SC_PUB packages/cli/dist/smartclaws device list
```

Export the channel addresses printed by `device list`:

```bash
export SHELLY_OUTGOING=0x<shelly outgoing from above>
export SHELLY_INCOMING=0x<shelly incoming from above>
export THERMAL_OUTGOING=0x<thermal outgoing from above>
```

### 2b. Master wallet

```bash
SC_MASTER=~/.sc-master

# Init — creates a separate wallet + config
SMARTCLAWS_HOME=$SC_MASTER packages/cli/dist/smartclaws init --network base-testnet

# Get the address and fund it
SMARTCLAWS_HOME=$SC_MASTER packages/cli/dist/smartclaws wallet info
```

Fund the address (same as publisher, not much CREDITS needed), then create the decision log channel:

```bash
# Creates a standalone channel owned by the master wallet
# (temporary workaround — agent register is broken on the deployed instance)
SMARTCLAWS_HOME=$SC_MASTER bun dev/create-agent-channel.ts
```

The script prints two ready-to-copy exports at the end — run them:

```bash
export MASTER_OUTGOING=0x<from script output>
export MASTER_WALLET=0x<from script output>
```

> NOTE: Currently an isolated Outgoing channel is used due to a detected bug in deployed smart-contracts (Not possible to deploy Agents on-chain). It's more than fair and working workarround before a new smart-claws instance is deployed.

### 2c. Authorize master to command the Shelly

The master wallet needs write access to Shelly's **incoming** channel (relay commands). Run this once with the publisher wallet:

```bash
SMARTCLAWS_HOME=$SC_PUB bun dev/authorize-controller.ts shelly-plug-s $MASTER_WALLET
```

Expected output:
```
Granting access to: 0x...
Done. Tx: 0x...
Status: success
The controller wallet can now publish to: 0x<SHELLY_INCOMING>
```

> Thermal has no incoming commands — no authorization needed there.

## 3. Start scripts in the background

Run each script in a separate terminal (or tmux pane) so you can watch the live output. All three must be running before starting the agent in step 4.

Set this once in every terminal you open for the simulators:

```bash
export SC_PUB=~/.sc-publisher
export SC_MASTER=~/.sc-master
export SMARTCLAWS_BIN=$(pwd)/packages/cli/dist/smartclaws
```

### 3a. Shelly bridge (real hardware)

Talks to the real Shelly Plug S over LAN: reads telemetry, publishes it on-chain, and polls for relay commands to execute. Make sure that you have Shelly inserted in a real plug, and also that you've configured it and connected it to your local network.

```bash
SMARTCLAWS_HOME=$SC_PUB \
SMARTCLAWS_BIN=$SMARTCLAWS_BIN \
DEVICE_NAME=shelly-plug-s \
INCOMING_CHANNEL=$SHELLY_INCOMING \
SHELLY_HOST=<shelly-ip-on-lan> \
python3 dev/shelly-bridge.py
```

Replace `<shelly-ip-on-lan>` with the Shelly's local IP. If you don't know it, run:

```bash
python3 dev/find-shelly.py
```

It should find the device in under 15 seconds. Copy the printed `export SHELLY_HOST=...` line and run it.


### 3b. Thermal simulator

Reads the Shelly relay state from the chain and simulates room temperature accordingly. Publishes to the `thermal-sensor` device (same publisher wallet, same device group).

```bash
SMARTCLAWS_HOME=$SC_PUB \
SMARTCLAWS_BIN=$SMARTCLAWS_BIN \
DEVICE_NAME=thermal-sensor \
SHELLY_OUTGOING_CHANNEL=$SHELLY_OUTGOING \
python3 dev/thermal-sim.py
```

### 3c. Energy tariff simulator

Writes a simulated OMIE-shaped energy price curve to a local file every second. The master agent reads this file directly — no on-chain publish needed.

```bash
TARIFF_FILE=$SC_MASTER/tariff.json \
python3 dev/tariff-sim.py
```

`DAY_SECONDS` controls how fast the simulated day runs — default is `7200` (2-hour day). Use `DAY_SECONDS=86400` for real-time.

## 4. Set up the OpenClaw master agent

The agent workspace template is at `open-claw-setups/shelly-master-1/`. It contains all skills, policy, and a `BOOT.md` that guides first-time setup. You will:

1. Create the agent with OpenClaw (assigns a workspace path)
2. Copy the template files into that workspace
3. Create two symlinks the agent needs
4. Start the gateway
5. Boot the agent — it walks through a questionnaire and fills all `{{PLACEHOLDER}}` values
6. Kick off the recurring control cycle

### 4a. Create the agent

```bash
openclaw agents add smartclaws-master
```

During setup, it will prompt to pick a workspace. Keep in mind that if you are under `~/.openclaw/workspace`, your main agent will have access to the new agent's workspace. If this happens, when you delete the new agent, the workspace will not be automaticaly deleted because it is part of the main agent's workspace. If you need true independence, create a new workspace under `~/.openclaw/`


```bash
openclaw agents list
```

It will show something like `Workspace: ~/.openclaw/workspace/smartclaws-master/`. Export it:

```bash
export AGENT_WS=<workspace path from above>
```

### 4b. Copy the template into the workspace

```bash
cp -r open-claw-setups/shelly-master-1/. "$AGENT_WS/"
```

### 4c. Create the two required symlinks

The agent needs a `bin/smartclaws` executable and a `controller` config directory:

```bash
# SmartClaws CLI binary
mkdir -p "$AGENT_WS/bin"
ln -sf "$(pwd)/packages/cli/dist/smartclaws" "$AGENT_WS/bin/smartclaws"

# Master wallet home (keys + tariff file live here)
ln -sf ~/.sc-master "$AGENT_WS/controller"
```

Verify:

```bash
ls -la "$AGENT_WS/bin/smartclaws" "$AGENT_WS/controller"
```

### 4d. Start/Restart the gateway

```bash
openclaw gateway restart
```

> This tutorial ignores how you reach the gateway and other openclaw configs as that is of each user's prefference.

### 4e. Boot the agent (one-time)

Open the main session:

```bash
openclaw chat --session agent:smartclaws-master:main
```

The agent reads `BOOT.md` and runs through the setup questionnaire. Have the channel addresses from steps 2–3 ready:

| Prompt | Value |
|---|---|
| Operator name | your name |
| Operator timezone | e.g. `Europe/Lisbon` |
| Workspace root | `echo $AGENT_WS` |
| OpenClaw agent ID | `smartclaws-master` |
| `bin/smartclaws` symlink target | already created — confirm |
| `controller` symlink target | `~/.sc-master` — already created |
| Shelly outgoing channel | `$SHELLY_OUTGOING` |
| Shelly incoming channel | `$SHELLY_INCOMING` |
| Thermal outgoing channel | `$THERMAL_OUTGOING` |
| Agent outgoing (decision log) | `$MASTER_OUTGOING` |
| Policy defaults | accept defaults or adjust |

After you confirm, the agent substitutes every `{{PLACEHOLDER}}` across the workspace files, verifies the result, and deletes `BOOT.md`. Setup is complete.

### 4f. Start the control cycle

> NOTE: It is recommended to manualy ask the agent to run one cycle or prompt it do do a few things before running the chron cycle. It helps flagging initial bugs or missconfigured/uncovered steps.

Still in the main session, tell the agent to schedule itself:

```
Set up the smartclaws-master-cycle cron job — every 10 minutes.
```

If it doesn't run immediately you can trigger it manualy or wait - it will: read relay state and temperature from chain, checks the tariff file, makes its first decision, logs it on-chain, and schedules the next wake-up. The demo is live.

---

To chat with the agent later — from CLI or webchat — connect to the gateway address printed in step 4d. The agent answers status questions from any session; relay commands and policy changes are restricted to the main session.


