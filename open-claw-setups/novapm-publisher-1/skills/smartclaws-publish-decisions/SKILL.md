---
name: smartclaws-publish-decisions
description: >
  Publish cycle outcomes and observations to the on-chain decision log (the
  agent outgoing channel). Log every publish cycle result, every failed read,
  every threshold alert, and every noteworthy event — regardless of source.
  This is the permanent audit trail; logs on-chain are never too many.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "📝"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws NovaPM — Publish Decisions (On-Chain Cycle Log)

Record cycle outcomes to **your own outgoing channel** so they live on-chain.
This is the permanent audit trail: what the sensor read, whether it published,
whether a threshold was exceeded, and why anything went wrong.

The channel address is the fixed constant `AGENT_OUTGOING_CHANNEL` in
`AGENTS.md`. You publish here with `--from novapm-publisher`.

This writes a log entry — it does **not** publish sensor telemetry. Publishing
here is a normal part of every cycle and is never gated.

---

## When to publish — log everything

Publish an entry for every cycle, every outcome. Do not self-censor. Examples:

- **Successful publish** — log the PM2.5/PM10 values, whether they exceeded
  thresholds, and the telemetry transaction hash.
- **Sensor read failed** — log the error. This is important operational data.
- **Bad reading discarded** — log the implausible value and why it was rejected.
- **Warmup clamp** — log if `SENSOR_WARMUP_S` was below the minimum and was
  clamped to 15 s.
- **Threshold exceeded** — note it clearly in the log with the values.
- **Policy changed** — log what changed and what triggered it.
- **Cycle ran clean, nothing unusual** — log it. Confirms the publisher is alive.

Blockchain logs are cheap and filterable by `event` label — use descriptive
labels freely.

---

## What to write — reason it out in plain language

The payload is **hybrid**: a human-readable `reason` you write in your own
words, plus structured fields for filtering. Explain the cycle like you'd
explain it to Christian or Eduardo.

### Payload shape (`topic: cycle.log`)

```json
{
  "event": "published",
  "source": "cron",
  "reason": "Read SDS011 on /dev/ttyUSB0 after 30s warmup. PM2.5 12.3 µg/m³, PM10 28.1 µg/m³ — both within thresholds. Published to NOVAPM_OUTGOING_CHANNEL (Tx: 0xabc...).",
  "pm25_ug_m3": 12.3,
  "pm10_ug_m3": 28.1,
  "pm25_alert": false,
  "pm10_alert": false,
  "telemetry_tx": "0xabc123...",
  "ts": "2026-06-17T10:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `event` | Free-form label: `published`, `read-failed`, `bad-reading`, `threshold-exceeded`, `policy-change`, `cycle-ok`, `warmup-clamped`, etc. |
| `source` | What triggered this entry: `cron` (scheduled), `user` (manual via chat), `system` (boot/internal) |
| `reason` | **Your reasoning, in plain language** — the most important field; be concrete and specific |
| `pm25_ug_m3` | PM2.5 reading used this cycle (or `null` if read failed) |
| `pm10_ug_m3` | PM10 reading used this cycle (or `null` if read failed) |
| `pm25_alert` | `true` if PM2.5 exceeded `PM25_HIGH_UG_M3`, else `false` |
| `pm10_alert` | `true` if PM10 exceeded `PM10_HIGH_UG_M3`, else `false` |
| `telemetry_tx` | Transaction hash from the telemetry publish (or `null` if not published) |
| `ts` | ISO 8601 UTC timestamp |

Only `event`, `source`, and `reason` are strictly required. Fill the rest when
you have the values — use `null` rather than guessing.

---

## How to publish

```bash
SMARTCLAWS_HOME=~/.openclaw/workspace/controller \
  ~/.openclaw/workspace/bin/smartclaws publish \
  --channel 0x85E7c901bBd725c9F1224e0cbB6CDE89D1359011 \
  --from novapm-publisher \
  --topic cycle.log \
  --data '{"event":"published","source":"cron","reason":"...","pm25_ug_m3":12.3,"pm10_ug_m3":28.1,"pm25_alert":false,"pm10_alert":false,"telemetry_tx":"0xabc...","ts":"2026-06-17T10:00:00Z"}'
```

### Successful publish output

```
Published novapm-publisher/cycle.log to channel 0x...
  Tx:     0xabc123...
  Status: success
```

If publish fails: **fail loud** — say the cycle log could not be recorded.
Do not pretend it was logged.

---

## Reading your own log back

```bash
SMARTCLAWS_HOME=~/.openclaw/workspace/controller \
  ~/.openclaw/workspace/bin/smartclaws read \
  --channel 0x85E7c901bBd725c9F1224e0cbB6CDE89D1359011 --limit 10 --json
```

Filter by `event` to slice by outcome type; filter by `source` to slice by
trigger. This is the on-chain system of record for all publisher activity.
