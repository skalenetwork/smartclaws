---
name: smartclaws-shelly-master
description: >
  Run the smart controller for Shelly Plug S Gen3: read telemetry from SmartClaws
  outgoing channel, evaluate policy instructions, and publish commands to the
  Shelly device incoming channel when needed.
license: LGPL-3.0-or-later
compatibility: Requires smartclaws CLI and a clear policy prompt
metadata:
  openclaw:
    emoji: "\U0001F9E0"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["smartclaws"]
---

# SmartClaws Shelly Master (Policy Controller)

Device bundle: `skills/smartclaws-shelly-plug-s-gen3`
Reference: `skills/smartclaws-shelly-plug-s-gen3/reference.md`

This is **Agent 2** (smart controller). It reads blockchain telemetry and decides when to send commands.

Each invocation is one cycle: `smartclaws read` → policy → optional `publish`. Nothing here starts a background poller; something external (you, cron, automation) must invoke that cycle when you want fresh decisions.

## Responsibility

1. Read telemetry from device outgoing channel.
2. Apply policy/instructions from the user.
3. Publish command envelopes into the device incoming channel when action is needed.

Do not interact with Shelly hardware directly in this skill. Write only to on-chain command channel.

## Required Inputs

- `SMARTCLAWS_HOME` (controller config dir, e.g. `~/.sc-controller`)
- `OUTGOING_CHANNEL` (device telemetry source)
- `INCOMING_CHANNEL` (device command sink)
- Policy instructions, for example:
  - max power threshold
  - on/off schedule window
  - cooldown/debounce duration
  - comfort/cost tradeoff rule

If policy is ambiguous, ask clarifying questions before command publishing.

Preflight checks:

```bash
command -v smartclaws
smartclaws --version
```

Stop and report if the CLI is unavailable.

## Read Path

Use:

```bash
smartclaws read --channel <OUTGOING_CHANNEL> --limit 50 --json
```

Primary telemetry topic expected:

- `telemetry.switch_status`

Primary fields expected:

- `output`
- `apower_w`
- `voltage_v`
- `current_a`
- `energy_total`
- `temperature_c`

## Shared Data Contracts

Keep contracts synchronized with publisher skill and device reference.

Telemetry topic and payload (`telemetry.switch_status`):

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

Command topic and payload (`command.switch.set`):

```json
{ "on": true, "toggle_after": 0 }
```

## Command Write Path

Publish to the **device incoming channel** with:

- topic: `command.switch.set`
- payload:

```json
{ "on": true, "toggle_after": 0 }
```

Primary command publish form:

```bash
SMARTCLAWS_HOME=~/.sc-controller smartclaws publish \
  --channel <INCOMING_CHANNEL> \
  --from controller \
  --topic command.switch.set \
  --data '{"on": true, "toggle_after": 0}'
```

Use your environment's approved command-channel write method. If direct `smartclaws publish --channel` is unavailable, use the project-approved helper path for channel-level publishing.

## Decision Guardrails

- Debounce actions to avoid relay flapping.
- Enforce cooldown between opposite commands.
- Do not issue duplicate state commands when current state already matches desired state.
- Keep a decision log (reason + evidence + command published).
- Optional: persist a **small** last-decision summary (time, target relay state, cooldown until, one-line reason). Do **not** store telemetry copies there.
- If you need more history to confirm a trend or a past state, use a larger `--limit` or an extra `read`—the channel remains the source of truth.

## Example Decision Pattern

Given policy:

- turn **OFF** when `temperature_c` is at or above the user’s unsafe ceiling **and** the same read window shows a clear **upward** temperature trend the user considers unsafe
- turn **ON** again only when the user gives a recovery rule (temperature and/or trend), so the relay is not thrashing
- minimum **60s** between state changes

Behavior:

1. Read latest telemetry window (increase `--limit` if you need more history for trend or confirmation).
2. Determine desired state from policy.
3. Compare desired state vs current `output`.
4. If change required and cooldown passed, publish `command.switch.set`.

## Validation

- Reader consumes telemetry successfully from `OUTGOING_CHANNEL`.
- Published commands appear in `INCOMING_CHANNEL`.
- Edge bridge agent applies command and telemetry reflects new state.
- Decision log (or last-decision summary, if used) explains commands with policy rationale.
