---
name: smartclaws-publish-decisions
description: >
  Publish your decisions and reasoning to your on-chain decision log (the agent
  outgoing channel). Log every control cycle outcome, every relay state change,
  every hold, and every noteworthy event — regardless of source. This is the
  permanent audit trail; logs on-chain are never too many.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "📝"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws — Publish Decisions (On-Chain Decision Log)

Record decisions to **your own outgoing channel** so they live on-chain. This
is the permanent audit trail: what you did, what you decided not to do, and
*why* — in your own words.

The channel address is the fixed constant `AGENT_OUTGOING_CHANNEL` in
`AGENTS.md`. You publish here with `--from smartclaws-master`.

This writes a log entry — it does **not** command any device. Publishing is a
normal part of your job and is never gated.

---

## When to publish — log everything

Publish an entry for every decision, every cycle, every state change. Do not
self-censor. Examples of what to log:

- **Relay switched** (from cron, from a user request, from a comfort override,
  from any source) — log the new state, what triggered it, and why.
- **Decided to hold** — log that too, with the reasoning. A hold is a decision.
- **Coast / preheat** — log the window reasoning and the numbers you computed.
- **Stale or missing signal** — log that the cycle ran in degraded mode.
- **Policy changed** — log what changed and who/what triggered it.
- **Failure** — log the error and what you could not complete.
- **Cycle ran, nothing to do** — log it. A clean cycle with no action is still
  useful for confirming the controller is alive.

Blockchain logs are cheap and filterable by `decision` label — use descriptive
labels freely. There is no enum limit.

---

## What to write — reason it out in plain language

The payload is **hybrid**: a human-readable `reason` you write in your own
words, plus structured fields for charting and filtering. Think through the
decision and explain it like you'd explain it to {{OPERATOR_DISPLAY_NAME}}.

### Payload shape (`topic: decision.log`)

```json
{
  "decision": "relay-on",
  "source": "cron",
  "reason": "Preheating: room at 22.1°C, tariff flips to expensive in ~420s. Time-to-ceiling at current rate is ~310s — buying heat now saves ~0.12 EUR vs waiting.",
  "temp_c": 22.1,
  "trend_c_per_min": 0.04,
  "tier": "cheap",
  "relay_on": false,
  "acted": true,
  "ts": "2026-06-01T15:04:00Z"
}
```

| Field | Meaning |
|---|---|
| `decision` | Free-form label describing the decision — use descriptive strings like `relay-on`, `relay-off`, `hold`, `coast`, `preheat`, `override-floor`, `override-ceiling`, `policy-change`, `failed`, `cycle-ok`, etc. |
| `source` | What triggered this entry: `cron` (automated cycle), `user` (manual request via chat), `system` (startup, boot, or internal) |
| `reason` | **Your reasoning, in plain language** — the most important field; be concrete and specific |
| `temp_c` | Room temperature used in the decision (or `null` if unavailable) |
| `trend_c_per_min` | Thermal trend used (or `null`) |
| `tier` | Tariff tier at decision time: `cheap` / `mid` / `expensive` / `null` |
| `relay_on` | Relay state at decision time (bool, or `null`) |
| `acted` | `true` if you published a relay command this cycle, else `false` |
| `ts` | ISO 8601 timestamp |

Only `decision`, `source`, and `reason` are strictly required. Fill the rest
when you have the values — use `null` rather than guessing.

---

## How to publish

```bash
SMARTCLAWS_HOME={{WORKSPACE_ROOT}}/controller \
  {{WORKSPACE_ROOT}}/bin/smartclaws publish \
  --channel {{AGENT_OUTGOING_CHANNEL}} \
  --from smartclaws-master \
  --topic decision.log \
  --data '{"decision":"relay-on","source":"cron","reason":"...","temp_c":22.1,"tier":"cheap","relay_on":false,"acted":true,"ts":"2026-06-01T15:04:00Z"}'
```

### Successful publish output

```
Published smartclaws-master/decision.log to channel 0x...
  Tx:     0xabc123...
  Status: success
```

Capture the `Tx:` line if you need the hash. If publish fails, **fail loud** —
say the decision could not be recorded; do not pretend it was logged.

---

## Reading your own decisions back

Anyone can audit the log by reading the same channel (oldest-first; payload in
`p`, newest is `messages[-1]`):

```bash
SMARTCLAWS_HOME={{WORKSPACE_ROOT}}/controller \
  {{WORKSPACE_ROOT}}/bin/smartclaws read \
  --channel {{AGENT_OUTGOING_CHANNEL}} --limit 10 --json
```

This is the on-chain system of record for all decisions. Filter by `decision`
label to slice by event type; filter by `source` to slice by trigger.
