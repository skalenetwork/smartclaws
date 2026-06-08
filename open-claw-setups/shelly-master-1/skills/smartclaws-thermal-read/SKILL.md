---
name: smartclaws-thermal-read
description: >
  Read on-chain telemetry from the thermal sensor. Use this whenever someone asks
  for the current room temperature, whether it's warming or cooling (trend),
  ambient temperature, or the relay state as the sensor sees it. Read-only —
  never publishes or changes anything.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🌡️"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws Thermal Sensor — Read Telemetry

Read the latest telemetry the thermal sensor has published on-chain. This skill
is **read-only**: it never publishes a command, changes state, or touches the
wallet. Safe to run for anyone.

This is a **separate device from the Shelly plug**. For room temperature, read
here — not from the plug (the plug only reports its own device temperature). For
plug/relay status use `smartclaws-shelly-read`.

Paths, the channel address, and the binary location are the fixed constants in
`AGENTS.md`. Use those values — do not invent addresses.

---

## Channel

| What you want | Channel (from AGENTS.md) | Topic to filter |
|---|---|---|
| Room temperature + trend | `THERMAL_OUTGOING_CHANNEL` | `telemetry.thermal_status` |

---

## How to read

```bash
SMARTCLAWS_HOME={{WORKSPACE_ROOT}}/controller \
  {{WORKSPACE_ROOT}}/bin/smartclaws read \
  --channel {{THERMAL_OUTGOING_CHANNEL}} \
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
sensor has no data yet; do not guess values.

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
- Filter by `topic` (`telemetry.thermal_status`) to pick the right message.

---

## Payload — `telemetry.thermal_status`

```json
{
  "temperature_c": 24.85,
  "trend_c_per_min": -0.081,
  "ambient_c": 20.0,
  "relay_state": false,
  "stale_relay": false,
  "stale_relay_seconds": 0,
  "ts": "2026-05-29T12:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `temperature_c` | **Room** temperature |
| `trend_c_per_min` | Rate of change (°C/min); negative = cooling, positive = warming |
| `ambient_c` | Ambient/baseline temperature |
| `relay_state` | Relay state as seen by the sensor |
| `stale_relay` | `true` if the relay read is older than the freshness window |
| `stale_relay_seconds` | Age of the relay read (seconds) |
| `ts` | ISO 8601 timestamp of the reading |

---