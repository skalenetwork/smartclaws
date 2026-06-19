---
name: smartclaws-novapm-read
description: >
  Read on-chain PM2.5 and PM10 air quality telemetry from the NovaPM outgoing
  channel. Use when someone asks for the current or recent air quality readings,
  PM levels, whether thresholds were exceeded, or the sensor's last known
  measurement. Read-only — never publishes or changes anything.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🌫️"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws NovaPM Air Quality Sensor — Read Air Quality Telemetry

Read the latest PM2.5/PM10 measurements the sensor has published on-chain. This
skill is **read-only**: it never publishes a command, changes state, or touches
the wallet. Safe to run for anyone.

Paths, the channel address, and the binary location are the fixed constants in
`AGENTS.md`. Use those values — do not invent addresses.

---

## Channel

| What you want | Channel (from AGENTS.md) | Topic to filter |
|---|---|---|
| PM2.5 + PM10 readings | `NOVAPM_OUTGOING_CHANNEL` | `telemetry.air_quality` |

---

## How to read

```bash
SMARTCLAWS_HOME=~/.openclaw/workspace/controller \
  ~/.openclaw/workspace/bin/smartclaws read \
  --channel 0x336F128b054cA0137e2842abe2302099493BFf80 \
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
    { "offset": 41, "ts": 1780000000, "dev": "...", "topic": "...", "p": {} }
  ]
}
```

- `messages` is sorted **oldest-first** → the newest is `messages[-1]`.
- The payload you care about is always in the `p` field.
- Filter by `topic` (`telemetry.air_quality`) to pick the right message.

---

## Payload — `telemetry.air_quality`

```json
{
  "pm25_ug_m3": 12.3,
  "pm10_ug_m3": 28.1,
  "sensor": "sds011",
  "port": "/dev/ttyUSB0",
  "ts": "2026-06-17T10:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `pm25_ug_m3` | PM2.5 concentration in µg/m³ (fine particles ≤ 2.5 µm) |
| `pm10_ug_m3` | PM10 concentration in µg/m³ (coarser particles ≤ 10 µm) |
| `sensor` | Sensor model — always `sds011` for this setup |
| `port` | USB serial port the sensor was read from |
| `ts` | ISO 8601 UTC timestamp of the reading |

---

## Interpreting readings for people

When reporting to a human, translate the numbers into plain language alongside
the raw values. Use the thresholds from `AGENTS.md` (or `MEMORY.md` overrides) for the "alert" level; use
these WHO 24h reference levels for context:

| Level | PM2.5 (µg/m³) | PM10 (µg/m³) | Plain label |
|---|---|---|---|
| Good | 0–5 | 0–20 | "Good" |
| Moderate | 5–15 | 20–45 | "Moderate" |
| Elevated | 15–35 | 45–50 | "Elevated" |
| High | > 35 | > 50 | "High — alert threshold" |

Always report the raw µg/m³ values alongside the label. Always check the `ts`
field — if the most recent reading is more than twice the normal publish
interval old, note that the data may be stale and the sensor may not be running.

---

## Answering people

- For "what's the air quality?" → report both PM2.5 and PM10 with their plain
  labels and the timestamp of the reading.
- For "is it above threshold?" → compare against `PM25_HIGH_UG_M3` and
  `PM10_HIGH_UG_M3` from `AGENTS.md` (or `MEMORY.md` overrides), and say clearly yes/no with the values.
- For "when was the last reading?" → report the `ts` field and how long ago
  that was.
- If the channel is empty or data is stale → say so plainly. Do not present
  old values as current.
