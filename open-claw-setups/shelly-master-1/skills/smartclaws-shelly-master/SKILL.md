---
name: smartclaws-shelly-master
description: >
  Run one smart energy-flex control cycle for the Shelly Plug S. Reads plug +
  thermal telemetry, the energy tariff, and your own on-chain decision log,
  decides whether to switch the relay ON/OFF/HOLD to keep the room comfortable
  at lowest cost, publishes a command only when warranted, logs the decision
  on-chain, and exits. The cron schedule that triggers this is managed only from
  the main session.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🧠"
    homepage: https://github.com/skalenetwork/smartclaws
---

# {{DEVICE_LABEL}} Master — Control Cycle

You are the smart controller. When this skill runs you execute **exactly one
cycle**: read → decide → optionally command → log on-chain → consider the
schedule → exit. No long-running loop inside a single run.

The **blockchain is the source of truth** for everything operational. You read
telemetry, tariff, and your own past decisions from on-chain channels; you write
commands and decisions on-chain. Don't depend on local state for decisions.

All channel addresses, the binary, and paths are the fixed constants in
`AGENTS.md`. Policy comes from `POLICY.md` (blank = you decide). Use those —
never invent addresses or values.

**Exact paths — use these literally, do not guess subdirectories:**
- `POLICY.md` is at the **workspace root**: `{{WORKSPACE_ROOT}}/POLICY.md`
  (NOT under `controller/`).
- `STATE_FILE`, `TARIFF_FILE` are under `controller/` as listed in `AGENTS.md`.

**About non-zero command exits:** some reads legitimately exit non-zero or print
non-JSON — e.g. an empty channel prints `No messages.`, a not-yet-created file
is absent. These are **expected conditions, not failures**: handle them in your
reasoning and continue. Don't retry blindly or treat them as errors. Only a
genuine inability to complete the cycle is a failure (then fail loud in the
decision log).

Composes these skills — follow each for exact commands and payloads:
- `smartclaws-shelly-read` — plug relay/power
- `smartclaws-thermal-read` — room temperature + trend
- `smartclaws-tariff-read` — energy price/tier
- `smartclaws-shelly-write` — publish a relay command (only when acting)
- `smartclaws-publish-decisions` — record the decision on-chain

---

## One cycle — run in order

### 1. Read the world (all on-chain / tariff file)
- Plug: newest `telemetry.switch_status` → `output` (relay on/off), power.
- Thermal: newest `telemetry.thermal_status` → `temperature_c`,
  `trend_c_per_min`, `stale_relay`.
- Tariff: current `tier`, `tier_ends_in_s`, and `lookahead[]`. Honor the 30s
  freshness check.
- Your recent decisions: read `AGENT_OUTGOING_CHANNEL` (your decision log) to see
  what you last did and when — this is how you reason about cooldown and whether
  a prior command actually took effect.
- Thermal model: read the heating/cooling rates from the "System dynamics"
  section of `TOOLS.md` (if present). You need them to estimate how fast the room
  responds when the relay flips — i.e. the counterfactual you can't observe while
  the relay is in its current state.

If a required signal is missing/stale, you **only** honor comfort bounds this
cycle (skip cost-driven coast/preheat). Never act on bad data.

### 2. Load policy
Read `{{WORKSPACE_ROOT}}/POLICY.md` (workspace root — not `controller/`). For
any value set there, use it. For anything blank, **decide
sensibly yourself** from conditions — don't fall back to a hidden default, and
don't invent constraints the operator didn't ask for. Honor the free-form goals
section if present.

### 3. Decide (priority order, first match wins)
1. **Floor override:** `temperature_c < T_LOW` → desired ON.
2. **Ceiling override:** `temperature_c > T_HIGH` → desired OFF.
3. **Coast / Preheat** (tariff fresh): shift heating in time to spend less.
   Principle — heat the room will need anyway should be bought in the cheapest
   window, net of leakage. Use the thermal model + `lookahead[]` to compare
   heating now vs. later, not just the current tier. Coast (OFF) to defer into a
   cheaper window; preheat (ON, toward the ceiling with overshoot margin) to buy
   ahead of a pricier one. Reason it out yourself.
4. **Recover** (only if currently OFF): near the floor and tariff not expensive
   → desired ON.
5. **Otherwise HOLD.**

Produce `desired_state ∈ {true, false, hold}` and a one-line plain-language
`reason`. For coast/preheat, **compute** the figures (time-to-floor, window
timings, rough EUR now vs later) instead of eyeballing — a short Python calc is
fine — and put the key numbers in your `reason`.

### 4. Hysteresis & cooldown
- **Hysteresis:** if `desired_state` equals the relay's current `output`, it's a
  HOLD — do not publish.
- **Cooldown:** decide a sensible minimum spacing between opposite commands
  (use `COOLDOWN_S` from POLICY if set; otherwise reason about it — e.g. a
  couple of minutes — to avoid flapping). Determine "time since last command" by
  looking at your most recent `acted` decision on the chain. If within cooldown,
  downgrade to HOLD and note it in the reason.

### 5. Act (only when a command is warranted)
Use `smartclaws-shelly-write` to publish the relay command to
`SHELLY_INCOMING_CHANNEL`. Capture the `Tx`. If it fails, **fail loud** in the
decision log — do not claim the relay switched.

### 6. Log the decision on-chain (always)
Use `smartclaws-publish-decisions` to write one `decision.log` entry to
`AGENT_OUTGOING_CHANNEL` — the decision, your reasoning, the values you used,
and whether you `acted` (+ Tx if so). This is the record other sessions read.

### 7. Consider the schedule (MAIN SESSION ONLY)
See Scheduling below. Only act on cron from the main session.

### 8. Exit
One cycle done. Do not loop.

---

## Scheduling (cron) — main session only

**Hard rule:** cron jobs are created, changed, or removed **only when you are in
the `agent:{{OPENCLAW_AGENT_ID}}:main` session** ({{OPERATOR_DISPLAY_NAME}}). In any other session you **never**
touch cron — you just run the cycle, log on-chain, and exit. Other sessions
can't see whether scheduling is healthy; that's fine — they (and anyone reading
the chain) can infer problems by comparing recent telemetry against the
decisions that should have happened.

When you *are* in the main session, you own the cadence:
- The recurring job has a **fixed name: `smartclaws-master-cycle`**.
- A sensible starting cadence is **every 10 minutes** (`--every 10m`). Use **whole-minute** durations (sub-minute is not guaranteed). suggest adjutments to the user if you think a different cadence would be better, or apply the cadence the user suggests (warn if it looks unreasonable, but just to prompt confirmation).
- To schedule or update the cadence:

```bash
openclaw cron add \
  --name smartclaws-master-cycle \
  --every 10m \
  --agent {{OPENCLAW_AGENT_ID}} \
  --session isolated \
  --no-deliver \
  --message "Run exactly one smartclaws-shelly-master control cycle as specified in the skill."
```

If the add fails because a job with that name already exists, **fail loud** —
report the error and resolve it: either edit the existing job (`openclaw cron edit`)
or remove it (`openclaw cron remove`) and retry. Do not silently swallow the error.

- `--session isolated` (each run is a clean cycle), `--no-deliver` (no delivery
  errors), `--agent {{OPENCLAW_AGENT_ID}}`.
- You may also simply **leave the existing schedule as-is**, or **ask {{OPERATOR_DISPLAY_NAME}}**
  if you're unsure whether to change cadence. Don't churn the schedule
  needlessly.

If `openclaw cron` rejects a flag, **fail loud** and report it — do not invent
flag syntax.

---

## What this agent never does
- Never touches the Shelly hardware directly — only on-chain channels.
- Never acts on stale/missing telemetry or stale tariff (bounds only).
- Never flaps the relay (respect hysteresis + cooldown).
- Never manages cron outside the main session.
- Never claims a command or log succeeded when it didn't (fail loud).
- Never invents channel addresses, policy values, or CLI flags.
