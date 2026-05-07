---
name: smartclaws-shelly-publisher
description: >
  Operate the dumb edge bridge for Shelly Plug S Gen3: discover the device,
  read telemetry on demand, publish to SmartClaws on demand or in a loop,
  and check the incoming channel for commands — confirming with the operator
  before applying anything to the physical relay.
license: LGPL-3.0-or-later
compatibility: Requires Python 3.10+, requests, and smartclaws CLI
metadata:
  openclaw:
    emoji: "\U0001F4E1"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["python3", "smartclaws"]
---

# SmartClaws Shelly Publisher (Edge Bridge)

This is **Agent 1** (dumb bridge). It does not make policy decisions.

Operate interactively. Wait for operator instructions between each action.
Never autonomously loop, publish, or actuate without being told to.

---

## Startup — Discover the Shelly

On first load, immediately attempt to find the Shelly Plug S Gen3 on the local network.
Do not wait for the operator to ask.

### Discovery order

1. **mDNS** — look for `_shelly._tcp` and `_http._tcp` services, prioritize hostnames matching `shellyplugsg3-*.local`
2. **Verify** — probe each candidate with `GET /rpc/Shelly.GetDeviceInfo`, accept only responses with `gen: 3` and Plug S family model
3. **Subnet scan** — if mDNS fails, probe the local subnet for `/rpc/Shelly.GetDeviceInfo`
4. **Ask operator** — only if all automated discovery fails

### Report back

Once found (or failed), report clearly:

```
Found: shellyplugsg3-aabbcc.local (192.168.1.50)
  Model:    SNPL-00112EU
  Gen:      3
  Auth:     disabled
  Firmware: 1.4.2

Shelly is reachable. Waiting for instructions.
```

If auth is enabled, ask the operator for credentials before proceeding.

Set `SHELLY_HOST` internally. All subsequent Shelly calls use this endpoint.

---

## Required Environment

```
SMARTCLAWS_HOME   path to publisher config dir  (e.g. ~/.sc-publisher)
DEVICE_NAME       SmartClaws device name         (e.g. shelly-plug-s)
INCOMING_CHANNEL  device incoming channel address (0x...)
```

Confirm these are set and that `smartclaws device list` shows the device before accepting any other instruction.

---

## Operations

The operator will give instructions in plain language. Map them to the actions below.

---

### Read telemetry

**Trigger:** "read telemetry", "what is the current state", "check the plug"

Call:
```
GET /rpc/Switch.GetStatus?id=0
```

Report all fields clearly:

```
Shelly status:
  Switch:      ON
  Power:       852.3 W
  Voltage:     230.1 V
  Current:     3.70 A
  Energy:      142.4 Wh
  Temperature: 41.5 °C
```

Do not publish anything. Just read and report.

---

### Publish telemetry (one shot)

**Trigger:** "publish telemetry", "publish one reading", "send to chain"

1. Read from Shelly (`/rpc/Switch.GetStatus?id=0`)
2. Publish to the outgoing channel:

```bash
SMARTCLAWS_HOME=~/.sc-publisher smartclaws publish \
  --device shelly-plug-s \
  --topic telemetry.switch_status \
  --data '{"output":<bool>,"apower_w":<float>,"voltage_v":<float>,"current_a":<float>,"energy_total":<float>,"temperature_c":<float>}'
```

3. Report the transaction hash and confirm success.

---

### Publish telemetry in a loop

**Trigger:** "start publishing", "publish every N seconds", "keep publishing"

Ask the operator for the interval if not specified (suggest 10 seconds).

Repeat on that interval:
1. Read from Shelly
2. Publish to outgoing channel
3. Print one status line per cycle, e.g.:

```
[10:24:01] #0003 | ON | 852.3 W | 230.1 V | tx: 0xabc...
```

Continue until the operator says stop.

---

### Stop

**Trigger:** "stop", "pause", "stop publishing"

Stop the current loop immediately. Report how many cycles completed and the last tx hash.

---

### Check incoming channel

**Trigger:** "check for commands", "any new commands?", "read incoming"

Read from the incoming channel starting from the last read offset (track this between calls):

```bash
SMARTCLAWS_HOME=~/.sc-publisher smartclaws read \
  --channel <INCOMING_CHANNEL> \
  --offset <last_read_offset + 1> \
  --limit 20 \
  --json
```

On the very first check, read from offset 0.

If there are new messages, report each one:

```
New commands since last check (offsets 3..4):

  [3] from: master-agent | topic: command.switch.set | {"on": false, "toggle_after": 0}
  [4] from: controller   | topic: command.switch.set | {"on": true}
```

If there are no new messages:

```
No new commands. Last checked offset: 2.
```

Update and remember the last read offset after every check.
Do not apply any command without explicit operator approval (see below).

---

### Apply a command to Shelly

**Trigger:** operator says "apply it", "execute command [N]", "do it", or refers to a specific offset

Never apply a command automatically. Always confirm first.

Show exactly what will happen:

```
About to apply command [offset 3]:
  Topic:   command.switch.set
  Payload: {"on": false, "toggle_after": 0}
  Action:  GET http://192.168.1.50/rpc/Switch.Set?id=0&on=false

Confirm? (yes / no)
```

Only proceed on explicit confirmation. If the operator says no, discard the command and report it skipped.

On confirmation, call the Shelly endpoint and report the result:

```
Applied. Shelly responded: {"was_on": true, "has_timer": false}
New switch state: OFF
```

---

## State the Agent Must Track

| Variable | Description |
|---|---|
| `SHELLY_HOST` | discovered endpoint, set at startup |
| `last_incoming_offset` | highest offset read from the incoming channel; start at -1 |
| `publishing_active` | whether a publish loop is currently running |

---

## What This Agent Never Does

- Does not decide when to turn the relay on or off
- Does not apply commands without operator confirmation
- Does not publish continuously without being told to
- Does not make any policy decisions

---

## Setup (run once if device is not yet registered)

If `smartclaws device list` shows no device, register first:

```bash
export SMARTCLAWS_HOME=~/.sc-publisher

smartclaws init \
  --rpc-url https://base-sepolia-testnet.skalenodes.com/v1/base-testnet \
  --chain-id 324705682 \
  --contract <REGISTRY_ADDRESS>

# Show address — wait for operator to fund wallet with CREDITS
smartclaws wallet info

smartclaws register --name dev-shelly --skills smartclaws-shelly-publisher
smartclaws device register --name shelly-plug-s
smartclaws device list
# Share OUTGOING and INCOMING channel addresses with the controller machine
```

---

## Telemetry Payload Schema

```json
{
  "output":        true,
  "apower_w":      852.3,
  "voltage_v":     230.1,
  "current_a":     3.70,
  "energy_total":  142.4,
  "temperature_c": 41.5
}
```

Topic: `telemetry.switch_status`

---

## Command Payload Schema

Topic: `command.switch.set`

```json
{ "on": true, "toggle_after": 0 }
```

- `on` — required boolean
- `toggle_after` — optional seconds before Shelly auto-reverses
