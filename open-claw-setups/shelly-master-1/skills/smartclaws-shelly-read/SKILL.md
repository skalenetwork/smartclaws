---
name: smartclaws-shelly-read
description: >
  Read on-chain telemetry from the Shelly Plug S. Use this whenever someone asks
  for the current relay state (on/off), power, voltage, current, cumulative
  energy, or the plug's device temperature. Read-only — never publishes or
  changes anything.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "📈"
    homepage: https://github.com/skalenetwork/smartclaws
---

# {{DEVICE_LABEL}} — Read Telemetry

Read the latest telemetry the Shelly plug has published on-chain. This skill is
**read-only**: it never publishes a command, changes state, or touches the
wallet. Safe to run for anyone.

Paths, the channel address, and the binary location are the fixed constants in
`AGENTS.md`. Use those values — do not invent addresses.

---

## Channel

| What you want | Channel (from AGENTS.md) | Topic to filter |
|---|---|---|
| Plug status (relay on/off, power, plug temp) | `SHELLY_OUTGOING_CHANNEL` | `telemetry.switch_status` |

---

## How to read

```bash
SMARTCLAWS_HOME={{WORKSPACE_ROOT}}/controller \
  {{WORKSPACE_ROOT}}/bin/smartclaws read \
  --channel {{SHELLY_OUTGOING_CHANNEL}} \
  --limit 5 \
  --json
```

`--json` is required for machine-readable output.

### Empty channel

If the channel has no messages the CLI prints the literal string:

```
No messages.
```

This is **not JSON** — check for it before parsing. If you see it, say the
channel has no data yet; do not guess values.

### Response shape

```json
{
  "channel": "0x...",
  "total": 42,
  "latest": 41,
  "messages": [
    { "offset": 41, "ts": 1780000000, "dev": "...", "topic": "...", "p": { } }
  ]
}
```

- `messages` is sorted **oldest-first** → the newest is `messages[-1]`.
- The payload you care about is always in the `p` field.
- Filter by `topic` (`telemetry.switch_status`) to pick the right message.

---

## Payload — `telemetry.switch_status`

```json
{
  "output": true,
  "apower_w": 852.3,
  "voltage_v": 230.1,
  "current_a": 3.70,
  "energy_total": 142.4,
  "temperature_c": 41.5
}
```

| Field | Meaning |
|---|---|
| `output` | Relay state — `true` = ON, `false` = OFF |
| `apower_w` | Active power (watts) |
| `voltage_v` | Mains voltage |
| `current_a` | Current draw (amps) |
| `energy_total` | Cumulative energy (Wh) |
| `temperature_c` | **Plug internal** temperature — the device's own heat, not room temperature |

---
