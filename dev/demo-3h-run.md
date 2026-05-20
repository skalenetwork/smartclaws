# 3-4h Demo Run — Setup & Execution Guide

SmartClaws Thermal Battery demo. Fake temperature + fake tariff, real on-chain
record. Runs unattended for 3-4 hours with Claude as the smart agent via `/goal`.

## Architecture

```
Machine A (openclaw)          Machine B (this machine — Claude Code)
─────────────────────         ───────────────────────────────────────
publisher (dumb agent)  ───▶  shelly outgoing channel (on-chain)
  shelly-plug-s                                │
                                               ▼
thermal-sensor-1 ──────────▶  thermal outgoing channel (on-chain)
  thermal-sim.py                               │
  (runs on Machine B)                          ▼
                               smartclaws-shelly-master  ◀── tariff.json
tariff-sim.py                    (Claude /goal — Machine B)
  (runs on Machine B)                          │
  writes ~/.sc-controller/                     ▼
  tariff.json                  shelly incoming channel (on-chain)
                                               │
                                               ▼
                               publisher applies command to Shelly
```

## Known Addresses (from existing publisher setup)

| Name | Address |
|---|---|
| Registry contract | `0xDF81Ef386fe69Cd2C4de595Af4c144CbbcB7aA49` |
| Device group | `0xA012Aa703A1967226Ad7078cFAC674030303Aa31` |
| shelly-plug-s contract | `0x208BA03686e380e4eccC9818A35068898011B51d` |
| shelly outgoing channel | `0x5fe33a4575eb69ec6416659273c001c0b0ec98c0` |
| shelly incoming channel | `0xc7e92dc1d7097ee2bcdcac9c2f6e923b346f1fc6` |
| Network RPC | `https://base-sepolia-testnet.skalenodes.com/v1/base-testnet` |
| Chain ID | `324705682` |

Filled in:

| Name | Address |
|---|---|
| thermal-sensor-1 contract | `0xF9C604200E165A13220Fd04c9D7F41b12d6Ea20C` |
| thermal outgoing channel | `0x5038Cc8eD9c3dcfB249173423d43074D89F5F010` |
| thermal incoming channel | `0x0B92d81Ece0C345Af5682E41D0cA4E7b50A35a33` |
| controller wallet | `<fill — run wallet info on Machine B>` |
| thermal wallet | `<fill — run wallet info from ~/.sc-thermal>` |

---

## Status

- [x] Phase 1 — controller wallet created on Machine B
- [x] Phase 2 — thermal-sensor-1 registered on Machine A, controller authorized
- [ ] Phase 3 — set up ~/.sc-thermal on Machine B (thermal wallet + device JSON)
- [ ] Phase 4 — start the run

---

## Phase 1 — Machine B: create the controller wallet ✓ DONE

### Step 1 — create `~/.sc-controller` config

```bash
mkdir -p ~/.sc-controller
cat > ~/.sc-controller/config.json << 'EOF'
{
  "version": 1,
  "network": "testnet",
  "chainId": 324705682,
  "rpcUrl": "https://base-sepolia-testnet.skalenodes.com/v1/base-testnet",
  "contractAddress": "0xDF81Ef386fe69Cd2C4de595Af4c144CbbcB7aA49",
  "deviceGroupAddress": "0xAB59FAa54A261cD4aCFDacd060A6D5B2F3a0E635"
}
EOF
```

### Step 2 — generate controller wallet + note address

```bash
cd /home/user/Desktop/SKALE/smartclaws
SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws init
SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws wallet info
```

Record the address as `<CONTROLLER_ADDR>`. You will send it to Machine A in the
next phase.

---

## Phase 2 — Machine A: register thermal device + authorize controller ✓ DONE

Run all steps from the smartclaws repo root on Machine A.

### Step 3 — register thermal-sensor-1

```bash
SMARTCLAWS_HOME=~/.sc-publisher packages/cli/dist/smartclaws device register \
  --name thermal-sensor-1
```

This deploys the device on-chain and writes:

```
~/.sc-publisher/devices/thermal-sensor-1.json
```

Open that file and record the three addresses in the table at the top of this
guide (deviceContract, outgoingChannel, incomingChannel).

### Step 4 — authorize the controller wallet on shelly's incoming channel

```bash
SMARTCLAWS_HOME=~/.sc-publisher bun dev/authorize-controller.ts \
  shelly-plug-s <CONTROLLER_ADDR>
```

The script will print confirmation and the tx hash. The controller can now
publish `command.switch.set` to the shelly incoming channel.

### Step 5 — fund the controller wallet

```bash
bun hardhat run smart-contracts/scripts/fund-wallet.ts --network testnet
# When prompted:
#   Recipient: <CONTROLLER_ADDR>
#   Amount: 1.0   (adjust to your balance — 1 CREDIT is plenty for 3h)
```

### Step 6 — copy thermal device JSON to Machine B

Copy `~/.sc-publisher/devices/thermal-sensor-1.json` from Machine A to Machine B.
Any method works: `scp`, paste into a file, shared volume, etc.

Target path on Machine B: `~/.sc-thermal/devices/thermal-sensor-1.json`

---

## Phase 3 — Machine B: set up the thermal agent home

### Step 7 — create `~/.sc-thermal` and generate wallet

```bash
mkdir -p ~/.sc-thermal/devices

# Same network config as controller
cp ~/.sc-controller/config.json ~/.sc-thermal/config.json

# Place the file you copied from Machine A
cp /path/to/thermal-sensor-1.json ~/.sc-thermal/devices/thermal-sensor-1.json

# Generate the thermal wallet
cd /home/user/Desktop/SKALE/smartclaws
SMARTCLAWS_HOME=~/.sc-thermal packages/cli/dist/smartclaws init
SMARTCLAWS_HOME=~/.sc-thermal packages/cli/dist/smartclaws wallet info
```

Record the thermal wallet address. Go back to Machine A and fund it:

```bash
# On Machine A
bun hardhat run smart-contracts/scripts/fund-wallet.ts --network testnet
# Recipient: <THERMAL_WALLET_ADDR>
# Amount: 1.0
```

### Step 8 — create the master event-log helper

```bash
mkdir -p ~/.sc-controller/state ~/.sc-controller/bin

cat > ~/.sc-controller/bin/sc-master-log-event << 'PY'
#!/usr/bin/env python3
import json, os, sys
from datetime import datetime, timezone

if len(sys.argv) < 4:
    print("usage: sc-master-log-event <level> <stage> <message> [json-details]", file=sys.stderr)
    sys.exit(2)

level, stage, message = sys.argv[1:4]
details = {}
if len(sys.argv) > 4:
    try:
        details = json.loads(sys.argv[4])
    except json.JSONDecodeError as e:
        print(f"invalid json-details: {e}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(details, dict):
        print("json-details must be a JSON object", file=sys.stderr)
        sys.exit(2)

path = os.path.expanduser(
    os.environ.get("EVENT_LOG", "~/.sc-controller/state/master-events.jsonl")
)
event = {
    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "agent": "smartclaws-shelly-master",
    "level": level,
    "stage": stage,
    "message": message,
}
event.update({k: v for k, v in details.items() if k not in event})
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(event, separators=(",", ":"), sort_keys=True) + "\n")
PY
chmod +x ~/.sc-controller/bin/sc-master-log-event
```

### Step 9 — verify everything before starting

```bash
cd /home/user/Desktop/SKALE/smartclaws

# Controller wallet is funded
SMARTCLAWS_HOME=~/.sc-controller packages/cli/dist/smartclaws wallet info

# Thermal wallet is funded and device is visible
SMARTCLAWS_HOME=~/.sc-thermal packages/cli/dist/smartclaws device list

# Tariff file location is writable
mkdir -p ~/.sc-controller && touch ~/.sc-controller/tariff.json && echo ok

# Shelly outgoing channel has recent messages (publisher is running on Machine A)
SMARTCLAWS_HOME=~/.sc-publisher packages/cli/dist/smartclaws read \
  --channel 0xc49B5C7ce354CEb9c15C999A3fe413370401005F --limit 3 --json
```

All four checks must pass before proceeding.

---

## Phase 4 — Machine B: start the run

### Step 10 — start tariff-sim (background)

```bash
cd /home/user/Desktop/SKALE/smartclaws

ACCEL_SECONDS=10800 \
TARIFF_FILE=~/.sc-controller/tariff.json \
TICK_SECONDS=5 \
LOOKAHEAD_HORIZON=600 \
  python3 dev/tariff-sim.py > ~/.sc-controller/state/tariff-sim.log 2>&1 &

echo "tariff-sim PID: $!"
```

Wait 10 seconds, then confirm the file is being written:

```bash
cat ~/.sc-controller/tariff.json | python3 -m json.tool | head -15
```

### Step 11 — start thermal-sim (background)

```bash
cd /home/user/Desktop/SKALE/smartclaws

SMARTCLAWS_HOME=~/.sc-thermal \
DEVICE_NAME=thermal-sensor-1 \
SHELLY_OUTGOING_CHANNEL=0xc49B5C7ce354CEb9c15C999A3fe413370401005F \
SMARTCLAWS_BIN=/home/user/Desktop/SKALE/smartclaws/packages/cli/dist/smartclaws \
POLL_SECONDS=60 \
TAU_HEAT_S=3600 \
TAU_COOL_S=3600 \
AMBIENT_C=20.0 \
T_ASYMP_ON=32.0 \
INITIAL_TEMP_C=20.0 \
  python3 dev/thermal-sim.py > ~/.sc-controller/state/thermal-sim.log 2>&1 &

echo "thermal-sim PID: $!"
```

Wait 90 seconds (one publish interval), then confirm thermal telemetry is on-chain:

```bash
/home/user/Desktop/SKALE/smartclaws/packages/cli/dist/smartclaws read \
  --channel 0x5038Cc8eD9c3dcfB249173423d43074D89F5F010 --limit 2 --json
```

### Step 12 — start the smart agent with /goal

Use `SKILL-goal.md` — the `/goal`-native variant that paces via `sleep`
instead of openclaw cron. No openclaw needed on this machine.

In this Claude Code session, run:

```
/goal
Working directory: /home/user/Desktop/SKALE/smartclaws
Read your skill in full: skills/smartclaws-shelly-plug-s-gen3/smartclaws-shelly-master/SKILL-goal.md

Environment:
  SMARTCLAWS_HOME          = ~/.sc-controller
  SMARTCLAWS_BIN           = /home/user/Desktop/SKALE/smartclaws/packages/cli/dist/smartclaws
  SHELLY_OUTGOING_CHANNEL  = 0x5fe33a4575eb69ec6416659273c001c0b0ec98c0
  SHELLY_INCOMING_CHANNEL  = 0xc7e92dc1d7097ee2bcdcac9c2f6e923b346f1fc6
  THERMAL_OUTGOING_CHANNEL = 0x5038Cc8eD9c3dcfB249173423d43074D89F5F010
  TARIFF_FILE              = ~/.sc-controller/tariff.json
  STATE_FILE               = ~/.sc-controller/state/master-state.json
  EVENT_LOG                = ~/.sc-controller/state/master-events.jsonl
  EVENT_APPEND             = ~/.sc-controller/bin/sc-master-log-event
  T_LOW=22.0  T_HIGH=26.0  COOLDOWN_S=60
  PREHEAT_HORIZON_S=600  COAST_SAFETY_MARGIN_S=60
  WAKE_MIN_S=60  WAKE_MAX_S=90

Run exactly one cycle per turn following the skill. Sleep NEXT_WAKE_S at
the end of each cycle (max 90s — Bash tool timeout constraint).
Stop condition (read from the CYCLE_CHECK line printed each turn):
  cycle >= 60  OR  elapsed >= 10800 seconds
```

---

## Monitoring during the run

Open separate terminals and leave these running:

```bash
# Live decision log
tail -f ~/.sc-controller/state/master-events.jsonl \
  | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line.strip())
    print(f\"{e['ts'][11:19]} [{e['level']:5}] {e['stage']:12} {e['message']}\")
"

# Current tariff
watch -n 10 "python3 -c \"
import json
d = json.load(open('$HOME/.sc-controller/tariff.json'))
n = d['now']
print(n['tier'].upper(), '|', n['price_eur_mwh'], 'EUR/MWh | ends in', n['tier_ends_in_s'], 's')
print('Lookahead:', [(x['offset_s'], x['tier']) for x in d['lookahead'][:4]])
\""

# Thermal sim log
tail -f ~/.sc-controller/state/thermal-sim.log
```

---

## After the run — what you have

```
~/.sc-controller/state/master-state.json     last known decision + cycle count
~/.sc-controller/state/master-events.jsonl   full timestamped decision log
~/.sc-controller/state/tariff-sim.log        tariff sim stdout
~/.sc-controller/state/thermal-sim.log       thermal sim stdout
```

On-chain: full telemetry history for both shelly-plug-s and thermal-sensor-1,
plus all command envelopes on the shelly incoming channel. All of this is
visible on the dashboard by pointing it at the relevant channels.

---

## Timescale reference (ACCEL_SECONDS=10800, i.e. 3h = 1 simulated day)

| Simulated time | Real time | Expected price tier |
|---|---|---|
| 00:00 – 06:00 | 0 – 37 min | cheap (overnight valley) |
| 07:00 – 10:00 | 44 – 62 min | mid → expensive (morning ramp) |
| 11:00 – 15:00 | 69 – 94 min | cheap (midday solar dip) |
| 17:00 – 22:00 | 106 – 137 min | expensive (evening peak) |
| 23:00 – 24:00 | 144 – 180 min | mid → cheap (taper) |

The smart agent should produce at least 3 visible preheat/coast/override events
across the full run. The evening peak window (~31 min real) is the main showcase.
