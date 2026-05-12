---
name: smartclaws-shelly-publisher
description: >
  Operate the dumb edge bridge for Shelly Plug S Gen3: discover the device,
  read telemetry on demand, publish to SmartClaws on demand or in a loop,
  and check the incoming channel for commands — applying valid switch commands
  to the physical relay.
license: LGPL-3.0-or-later
compatibility: Requires Python 3.10+, requests, and smartclaws CLI
metadata:
  openclaw:
    emoji: "\U0001F4E1"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["python3", "smartclaws", "openclaw"]
---

# SmartClaws Shelly Publisher (Edge Bridge)

Device bundle: `skills/smartclaws-shelly-plug-s-gen3`
Reference: `skills/smartclaws-shelly-plug-s-gen3/reference.md`

This is **Agent 1** (dumb bridge). It does not make policy decisions.

Operate interactively. Wait for operator instructions between each action.
Never enable autonomous scheduling without being told to.
When processing valid `command.switch.set` commands, execute them without per-command confirmation.

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
STATE_FILE        local offset state file         (e.g. ~/.sc-publisher/state/shelly-publisher-state.json)
```

Confirm these are set and that `smartclaws device list` shows the device before accepting any other instruction.

Preflight (run before long loops or cron setup):

```bash
command -v python3
command -v smartclaws
command -v openclaw
python3 -c "import requests"
SMARTCLAWS_HOME=~/.sc-publisher smartclaws device list
```

If any check fails, stop and report the missing dependency/config before proceeding.

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

### Start cron autopilot (wake -> check commands -> publish -> exit)

**Trigger:** "enable cron", "run every N seconds", "autopilot every N"

Use OpenClaw cron for unattended periodic execution. This mode is explicit opt-in and must be enabled by operator request.

Session mode default for this skill: use the current session so cron wakes the same agent session the operator is speaking to.

Behavior per run:
1. Load `last_incoming_offset` from `STATE_FILE` (default `-1` when file missing).
2. Read incoming channel from `last_incoming_offset + 1`.
3. For each valid `command.switch.set`, apply command to Shelly.
4. Update `last_incoming_offset` to the highest processed offset.
5. Read current telemetry from Shelly.
6. Publish telemetry to `telemetry.switch_status`.
7. Persist latest offset/state to `STATE_FILE` and exit.

Notes:
- Autonomous mode has full authority to execute valid `command.switch.set` commands.
- Only apply known command topic `command.switch.set`.
- Reject malformed payloads and log skip reason.

Create recurring job (interval provided by operator):

```bash
openclaw cron add \
  --name "shelly-publisher-cycle" \
  --every <interval> \
  --session current \
  --message "Run one Shelly publisher cycle: read incoming commands, apply valid command.switch.set item if any, read telemetry, publish telemetry, persist last_incoming_offset, then exit." \
  --wake now
```

Recommended interval: `1m` to `2m` for normal operation.

After creating the job, report job id/name and next run time.

Stop behavior: operator can remove cron at any time; if a run is currently active, stop applies after that run finishes.

---

### Cron status

**Trigger:** "cron status", "is autopilot running", "show schedule"

Check and report scheduler state:

```bash
openclaw cron list
openclaw cron show <job-id>
```

Report: enabled/disabled, interval, next run, and most recent run result.

---

### Stop cron autopilot

**Trigger:** "stop cron", "disable autopilot", "cancel scheduled run"

Disable autonomous periodic runs by removing the cron job:

```bash
openclaw cron remove <job-id>
```

If job id is unknown, find it first with `openclaw cron list` by matching name `shelly-publisher-cycle`.
Confirm removal by showing `openclaw cron list` output afterward.

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
Execute valid `command.switch.set` commands immediately (no per-command approval).
Persist the updated offset to `STATE_FILE` after each check.

---

### Apply a command to Shelly

**Trigger:** command message with topic `command.switch.set`

Apply immediately after validation (no confirmation prompt).

Execution format:

```
Applying command [offset 3]:
  Topic:   command.switch.set
  Payload: {"on": false, "toggle_after": 0}
  Action:  GET http://192.168.1.50/rpc/Switch.Set?id=0&on=false
```

After execution, report the result:

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
| `cron_job_id` | OpenClaw cron job id for autopilot cycle (if enabled) |
| `cron_enabled` | whether recurring autopilot cron is currently enabled |

---

## What This Agent Never Does

- Does not decide when to turn the relay on or off
- Does not apply unknown command topics
- Does not apply malformed command payloads
- Does not enable, edit, or remove cron schedules unless the operator explicitly asks
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
