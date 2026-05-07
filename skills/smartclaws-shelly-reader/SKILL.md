---
name: smartclaws-shelly-reader
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

# SmartClaws Shelly Reader (Policy Controller)

This is **Agent 2** (smart controller). It reads blockchain telemetry and decides when to send commands.

## Responsibility

1. Read telemetry from device outgoing channel.
2. Apply policy/instructions from the user.
3. Publish command envelopes into the device incoming channel when action is needed.

Do not interact with Shelly hardware directly in this skill. Write only to on-chain command channel.

## Required Inputs

- `OUTGOING_CHANNEL` (device telemetry source)
- `INCOMING_CHANNEL` (device command sink)
- Policy instructions, for example:
  - max power threshold
  - on/off schedule window
  - cooldown/debounce duration
  - comfort/cost tradeoff rule

If policy is ambiguous, ask clarifying questions before command publishing.

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
- `temperature_c`

## Command Write Path

Publish to the **device incoming channel** with:

- topic: `command.switch.set`
- payload:

```json
{ "on": true, "toggle_after": 0 }
```

Use your environment's approved command-channel write method. If direct `smartclaws publish --channel` is unavailable, use the project-approved helper path for channel-level publishing.

## Decision Guardrails

- Debounce actions to avoid relay flapping.
- Enforce cooldown between opposite commands.
- Do not issue duplicate state commands when current state already matches desired state.
- Keep a decision log (reason + evidence + command published).

## Example Decision Pattern

Given policy:

- turn OFF when `apower_w > 1800`
- turn ON when `apower_w < 1200`
- minimum 60s between state changes

Behavior:

1. Read latest telemetry window.
2. Determine desired state from policy.
3. Compare desired state vs current `output`.
4. If change required and cooldown passed, publish `command.switch.set`.

## Validation

- Reader consumes telemetry successfully from `OUTGOING_CHANNEL`.
- Published commands appear in `INCOMING_CHANNEL`.
- Edge bridge agent applies command and telemetry reflects new state.
- Decision log explains each command with policy rationale.
