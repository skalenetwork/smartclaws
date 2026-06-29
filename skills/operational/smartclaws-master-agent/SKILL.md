---
name: smartclaws-master-agent
description: >
  Run one SmartClaws master control cycle: read device telemetry on-chain, decide
  under the owner's guidelines, command a device only when allowed, and log the
  decision on-chain. Trigger when asked to run a control cycle, check devices and
  decide, command a device, or audit recent decisions. Needs the SmartClaws plugin
  and a device contract skill per device.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🧠"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      config: ["plugins.entries.smartclaws"]
---

# SmartClaws Master — Control Cycle

This skill is a **procedure**: it runs **one control cycle** when asked — read
telemetry → decide → command if allowed → log on-chain → exit. Your identity,
behaviour, and command-authority are not defined here; they live in your
owner-owned `AGENTS.md` (loaded every session), which wins on any conflict.

This procedure is **device-independent** and **policy-free**. Device facts come
from device contract skills; deployment wiring from `SMARTCLAWS.md`; behaviour,
authority, and any control policy from `AGENTS.md`.

## Required Context

Before running the cycle, identify:

- **`AGENTS.md`** — your behaviour, authority/permissions, and standing guidelines.
- **`SMARTCLAWS.md`** at the workspace root — devices, channels, which devices are
  `commandable`.
- **Device contract skills** for every device you read or command.
- **The SmartClaws plugin** — `smartclaws_read` / `smartclaws_publish` /
  `smartclaws_wallet_info`.

If `SMARTCLAWS.md` is missing or lacks a device/channel you need, **stop and run
the `smartclaws` onboarding skill** (or ask the owner). Never invent addresses,
device names, or authority.

## Scope of this procedure

While running a cycle you:

- Read outgoing telemetry channels for many devices, and your own decision log.
- Decide whether a command is warranted from telemetry + the owner's guidelines.
- Publish a command to a device's **incoming** channel only when it is marked
  `commandable` in `SMARTCLAWS.md`, the payload matches the device contract, and —
  **for whether the current caller/session is allowed to make you act — your
  `AGENTS.md` authorizes it.** This skill does not define that allowlist; defer to
  `AGENTS.md` and refuse if it doesn't grant the action.
- Log every outcome to your agent outgoing channel.

This procedure never touches local hardware directly (that's a bridge's job),
never publishes to an absent/null/telemetry-only incoming channel, and never
reads or prints wallet/key material.

## The Cycle — run exactly one

1. Load `AGENTS.md` guidelines and `SMARTCLAWS.md` wiring.
2. Select the device contract skills needed for the request.
3. Read telemetry from each relevant outgoing channel with `smartclaws_read`.
4. Validate freshness and payload shape using each device contract.
5. Decide: act, hold, ask, or fail loud. Where the owner's guidelines are blank,
   decide sensibly from conditions — don't invent constraints the owner didn't set.
6. If acting, confirm the action is authorized by `AGENTS.md`, then publish
   **exactly one** command with `smartclaws_publish` to the allowed incoming
   channel. Capture the transaction hash.
7. Publish a `decision.log` event to your agent outgoing channel (always — below).
8. Report what happened, including transaction hashes when a publish succeeded.

Do not loop inside one invocation. Cadence/scheduling is an owner/operations
choice, set in `AGENTS.md` or your own setup — not here.

## Decision Log (on-chain audit trail)

Record **every** cycle outcome to your own outgoing channel — actions, holds,
degraded/stale runs, failures. On-chain logs are cheap and filterable; don't
self-censor. Publish with `smartclaws_publish` to your agent outgoing channel,
topic `decision.log` (unless `SMARTCLAWS.md` overrides it).

Payload — a human-readable `reason` plus structured fields:

```json
{
  "decision": "preheat",
  "source": "cron",
  "reason": "Plain-language explanation with the key numbers you computed.",
  "acted": true,
  "devices": ["shelly-plug"],
  "ts": "<current ISO 8601 UTC>"
}
```

- `decision`: free-form label (`relay-on`, `hold`, `coast`, `failed`,
  `cycle-ok`, …). No fixed enum.
- `source`: what triggered it (`cron`, `user`, `system`).
- `reason`: your reasoning in plain language — the most important field.
- `acted`: `true` only if you published a device command this cycle.
- Add device-specific numeric fields when you have them; use `null`, never a guess.

Only `decision`, `source`, and `reason` are strictly required. Never claim a
command or log succeeded unless the plugin returned success.

## Failure Rules

- Missing/incomplete setup: run the `smartclaws` skill or ask for `SMARTCLAWS.md`.
- Unknown channel: stop; do not guess.
- Stale or malformed telemetry: avoid command actions unless the owner's
  guidelines explicitly allow it.
- Plugin publish failure: fail loud; do not report the physical state changed.
- Device contract conflict: prefer the stricter safety rule and ask for clarity.
