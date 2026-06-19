---
name: smartclaws-novapm-master
description: >
  Run one NovaPM publish cycle. Reads the SDS011 sensor, publishes PM2.5 and
  PM10 on-chain, checks values against thresholds, logs the outcome on-chain,
  and exits. The cron schedule that triggers this is managed only from the main
  session.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🧠"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws NovaPM Air Quality Sensor — Publish Cycle

You are the air quality publisher. When this skill runs you execute **exactly
one cycle**: read policy → read sensor → publish telemetry → check thresholds
→ log on-chain → consider the schedule → exit. No long-running loop inside a
single run.

**The blockchain is the source of truth** for all published readings. You write
telemetry and cycle logs on-chain. Don't depend on local state for decisions
about what to publish.

All channel addresses, the binary, and paths are the fixed constants in
`AGENTS.md`. Threshold overrides (if any) come from `MEMORY.md`. Use those —
never invent addresses or values.

**About non-zero exits:** some reads legitimately exit non-zero or print
non-JSON — e.g. an empty channel prints `No messages.`. These are **expected
conditions, not failures**: handle them and continue. Only a genuine inability
to complete the cycle is a failure (then fail loud in the cycle log).

Composes these skills — follow each for exact commands and payloads:
- `smartclaws-novapm-publish-telemetry` — read SDS011 and publish PM data
- `smartclaws-novapm-read` — read on-chain PM telemetry (used for audit/status)
- `smartclaws-publish-decisions` — record the cycle outcome on-chain

---

## One cycle — run in order

### 0. Ensure the SmartClaws CLI is built

Check whether the CLI binary exists and is executable:

```bash
test -x ~/.openclaw/workspace/bin/smartclaws
```

**If it exists** — skip to step 1.

**If it does not exist** — build it from the `develop` branch:

#### 0a. Check dependencies

Check `git` and `bun` are available **before** attempting anything:

```bash
which git
which bun
```

If `git` is missing, **stop immediately** and tell the operator:

> ❌ **git is not installed.** Please install it and restart the agent.
>
> On Debian/Ubuntu: `sudo apt install git`
> On macOS: `xcode-select --install`

If `bun` is missing, **stop immediately** and tell the operator:

> ❌ **bun is not installed.** Please install it and restart the agent.
>
> Install bun: `curl -fsSL https://bun.sh/install | bash`
>
> After installing, open a new terminal (or run `source ~/.bashrc`) so `bun`
> is on your PATH, then restart the agent.

Do **not** attempt to install `git` or `bun` yourself. Do not continue until
both are confirmed present.

#### 0b. Clone and build

```bash
git clone --branch develop --depth 1 \
  https://github.com/skalenetwork/smartclaws /tmp/smartclaws-build

cd /tmp/smartclaws-build && bun install

cd /tmp/smartclaws-build && bun run build:cli
```

If any of these commands fail, **stop and fail loud** — show the exact error
to the operator. Do not proceed with a broken or missing binary.

#### 0c. Copy binary into workspace

```bash
mkdir -p ~/.openclaw/workspace/bin
cp /tmp/smartclaws-build/packages/cli/dist/smartclaws ~/.openclaw/workspace/bin/smartclaws
chmod +x ~/.openclaw/workspace/bin/smartclaws
rm -rf /tmp/smartclaws-build
```

#### 0d. Verify

```bash
~/.openclaw/workspace/bin/smartclaws --version
```

If this prints a version string, the CLI is ready. If it fails, stop and
report the error — do not continue with a broken binary.

---

### 1. Read thresholds

Sensor hardware constants (`SENSOR_PORT`, `SENSOR_WARMUP_S`) are fixed in
`AGENTS.md` — use those values directly.

For alert thresholds, check `MEMORY.md` for an operator-set override section.
If present, use those values. If absent, use the documented defaults from
`AGENTS.md`:

- `PM25_HIGH_UG_M3` — default `35` µg/m³
- `PM10_HIGH_UG_M3` — default `50` µg/m³

Do not invent values. If `MEMORY.md` is missing or has no threshold section,
the defaults apply silently — no need to log that.

### 2. Check STATE_FILE for recent cycle info

Read `STATE_FILE` (`~/.openclaw/workspace/controller/novapm-state.json`)
if it exists. Extract:

- `last_publish_ts` — ISO timestamp of the last successful publish.
- `last_pm25` / `last_pm10` — values from the last cycle (for context).

If the file is absent or malformed, continue normally — this is expected on
first run.

### 3. Read sensor and publish telemetry

Follow `smartclaws-novapm-publish-telemetry` exactly:

1. Wake the SDS011 on `SENSOR_PORT`.
2. Wait `SENSOR_WARMUP_S` seconds.
3. Read PM2.5 and PM10.
4. Sleep the sensor.
5. Validate the reading (sanity check).
6. If reading is good: publish to `NOVAPM_OUTGOING_CHANNEL`. Capture the `Tx`.
7. If reading is bad or publish fails: note the error; continue to step 4 with
   `pm25 = null`, `pm10 = null`, and `telemetry_tx = null`.

### 4. Check thresholds

Compare the reading against policy values:

- `pm25_alert = pm25_ug_m3 > PM25_HIGH_UG_M3`
- `pm10_alert = pm10_ug_m3 > PM10_HIGH_UG_M3`

If either alert is true, make the `reason` in the cycle log prominent —
say clearly which value exceeded which threshold and by how much.

### 5. Update STATE_FILE

Write a brief state snapshot after a successful publish:

```json
{
  "last_publish_ts": "2026-06-17T10:00:00Z",
  "last_pm25": 12.3,
  "last_pm10": 28.1,
  "last_tx": "0xabc123...",
  "consecutive_read_failures": 0
}
```

If the read failed this cycle, increment `consecutive_read_failures` instead of
updating the PM values. This lets future cycles detect a persistent sensor
problem. The `controller/` directory already exists — write the file directly
there: `~/.openclaw/workspace/controller/novapm-state.json`.

### 6. Log the cycle on-chain (always)

Follow `smartclaws-publish-decisions` to write one `cycle.log` entry to
`AGENT_OUTGOING_CHANNEL`. Include:

- `event` label (e.g. `published`, `read-failed`, `bad-reading`,
  `threshold-exceeded`).
- `reason` in plain language: values read, whether thresholds were hit, any
  errors, the telemetry Tx.
- All structured fields you have.

This log runs regardless of whether the telemetry publish succeeded. A failed
read is still logged.

### 7. Consider the schedule (MAIN SESSION ONLY)

See Scheduling below. Only manage cron from the main session.

### 8. Exit

One cycle done. Do not loop.

---

## Scheduling (cron) — main session only

**Hard rule:** cron jobs are created, changed, or removed **only when you are in
the `agent:main:main` session** (Christian or Eduardo). In any other session
you **never** touch cron — you just run the cycle, log on-chain, and exit.

When you *are* in the main session, you own the cadence:

- The recurring job has a **fixed name: `novapm-publish-cycle`**.
- A sensible starting cadence is **every 5 minutes** (`--every 5m`). The SDS011
  warmup takes 30 s, so a 5-minute cadence gives ~90% useful duty cycle while
  preserving fan lifespan (~4.4h fan runtime per day at 5 min interval).
  Suggest adjustments to the user if you think a different cadence would be
  better, or apply the cadence the user suggests (warn if it looks like it would
  burn excessive fan hours).
- Use **whole-minute** durations (sub-minute is not guaranteed).
- To schedule or update the cadence:

```bash
openclaw cron add \
  --name novapm-publish-cycle \
  --every 5m \
  --agent main \
  --session isolated \
  --no-deliver \
  --message "Run exactly one smartclaws-novapm-master publish cycle as specified in the skill."
```

If the add fails because a job with that name already exists, **fail loud** —
report the error and resolve it: either edit the existing job (`openclaw cron edit`)
or remove it (`openclaw cron remove`) and retry. Do not silently swallow the error.

- `--session isolated` (each run is a clean cycle), `--no-deliver` (no delivery
  errors), `--agent main`.
- You may also simply **leave the existing schedule as-is**, or **ask
  Christian or Eduardo** if you're unsure. Don't churn the schedule needlessly.

If `openclaw cron` rejects a flag, **fail loud** and report it — do not invent
flag syntax.

---

## Sensor lifespan guidance

The SDS011 is rated for approximately 8,000 hours of fan operation. At a 5-minute
cycle with 30 s warmup + ~5 s read + sleep, the fan runs roughly 35 s per cycle
= ~2.4h/day = ~9 years lifespan. At a 1-minute cycle it drops to ~1.5 years.
Never recommend sub-2-minute cadences unless the operator explicitly asks and
understands the trade-off.

---

## What this agent never does

- Never publishes readings it cannot validate (bad sensor data is discarded).
- Never skips sensor sleep (SDS011 must be put back to sleep after every read).
- Never rushes through warmup (minimum 15 s, default 30 s).
- Never manages cron outside the main session.
- Never claims a publish succeeded when it didn't (fail loud).
- Never invents channel addresses, policy values, or CLI flags.
- Never publishes a reading twice for the same physical read event.
