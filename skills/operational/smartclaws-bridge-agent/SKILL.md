---
name: smartclaws-bridge-agent
description: >
  Run one SmartClaws bridge cycle for a single device: read the local hardware/API,
  validate against the device contract, and publish telemetry on-chain — and, in a
  command-enabled mode, apply on-chain commands. Trigger when asked to read the
  sensor and publish, run a telemetry/bridge cycle, or apply incoming device
  commands. Needs the SmartClaws plugin and one device contract skill.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🔌"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      config: ["plugins.entries.smartclaws"]
---

# SmartClaws Bridge — Telemetry / Command Cycle

This skill is a **procedure**: it runs **one bridge cycle** when asked — read the
device → validate → publish telemetry (and apply a command if your mode allows) →
exit. Your identity, behaviour, and off-schedule authority are not defined here;
they live in your owner-owned `AGENTS.md` (loaded every session), which wins on any
conflict.

This procedure is **device-independent** and **policy-free**. Device facts come
from the device contract skill; deployment wiring from `SMARTCLAWS.md`; behaviour
and authority from `AGENTS.md`.

## Required Context

Before running the cycle, identify:

- **`AGENTS.md`** — your behaviour and authority.
- **`SMARTCLAWS.md`** at the workspace root — your one device entry and channels.
- **The matching device contract skill** (e.g. `smartclaws-device-novapm-sds011`).
- **The bridge mode**: `telemetry-only`, `chain-commanded`, or
  `operator-assisted`. If absent, **fail closed to `telemetry-only`**.
- **The SmartClaws plugin** — `smartclaws_read` / `smartclaws_publish` /
  `smartclaws_wallet_info` (and `smartclaws_notify` if your setup coordinates with
  another agent's inbox).

If setup is missing or more than one device is assigned with no clear primary,
**stop and run the `smartclaws` onboarding skill** or ask the owner. This
procedure owns exactly one device and never orchestrates others.

When calling SmartClaws plugin tools, use the device entry's `name` field or the
explicit channel address from `SMARTCLAWS.md`. For plugin `agent` targets, use
the agent entry's `id` or `address`; display names are not reliable lookup keys.

## Bridge Modes

`telemetry-only`
: Read the device/integration and publish telemetry to its outgoing channel. Do
  not read or apply incoming commands.

`chain-commanded`
: Publish telemetry and read incoming SmartClaws commands. Apply a command only
  when it matches the device contract and arrives on the configured incoming
  channel.

`operator-assisted`
: Same as `chain-commanded`, plus direct user commands — but only from a
  session your `AGENTS.md` authorizes. This skill does not define that allowlist;
  defer to `AGENTS.md`. Reflect direct commands on-chain when configured.

## Telemetry Cycle — run exactly one

1. Load `SMARTCLAWS.md` and the device contract.
2. Read local hardware/API using the device contract protocol.
3. Validate the reading against the device contract sanity rules.
4. Publish telemetry with `smartclaws_publish` to the configured outgoing channel.
5. If configured, publish a bridge/cycle log to your agent outgoing channel.
6. Update local state only where your owner's setup permits it.
7. Exit.

Do not publish simulated data unless the user explicitly asks for simulation and
the payload is clearly labelled as simulated.

## Command Cycle (only in `chain-commanded` / `operator-assisted`)

1. Read the configured incoming channel with `smartclaws_read`.
2. Process only new offsets not previously handled.
3. Validate topic and payload against the device contract.
4. Apply exactly the mapped local command.
5. Persist the last handled offset where your owner's setup permits.
6. Publish a command-result or bridge log when configured.

Ignore unknown topics safely and log them when useful. Never execute arbitrary
commands from payloads.

## Guardrails for this procedure

- Own one device/integration; never publish commands to other devices.
- Never publish bad data — discard and log implausible readings.
- Never read or print wallet/key material or secrets.
- Never bypass device contract validation.
- Fail loud on sensor/API/publish failures; never report fake success.

Cadence/scheduling is an owner/operations choice (e.g. OpenClaw cron), set in
`AGENTS.md` or your own setup — this procedure runs one cycle per invocation.
