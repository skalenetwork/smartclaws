---
name: smartclaws-shelly-publisher
description: >
  Run the dumb edge bridge for Shelly Plug S Gen3: read Shelly telemetry and
  publish to SmartClaws outgoing channel, then read SmartClaws incoming commands
  and apply them back to Shelly. Use when operating the device-side bridge agent.
license: LGPL-3.0-or-later
compatibility: Requires Python 3.10+, requests, and smartclaws CLI
metadata:
  openclaw:
    emoji: "\U0001F4E1"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["python3", "smartclaws"]
---

# SmartClaws Shelly Publisher (Edge Bridge)

This is **Agent 1** (dumb bridge). It does not make policy decisions.

## Responsibility

Only perform these two loops:

1. Shelly status -> SmartClaws device outgoing channel
2. SmartClaws device incoming channel -> Shelly switch command

Do not infer strategy, optimize timing, or create autonomous policies.

## Inputs

- `SHELLY_HOST` (optional override; agent should discover automatically first)
- `DEVICE_NAME` (default: `shelly-plug-s`)
- `INCOMING_CHANNEL` (device incoming)
- Optional: `SHELLY_USER`, `SHELLY_PASS`
- Optional: `POLL_SECONDS`, `STATE_FILE`

## Endpoint Discovery (Required, Same-LAN)

Assume the agent host and Shelly are on the same local network. The agent must discover the Shelly endpoint automatically before asking the user.

Discovery order:

1. **mDNS first (preferred)**
   - discover `_shelly._tcp` and `_http._tcp` candidates
   - prioritize hostnames matching `shellyplugsg3-*.local`
2. **Candidate verification**
   - probe each candidate with `GET /rpc/Shelly.GetDeviceInfo`
   - accept only responses with expected Gen3/Plug S family identity
3. **Subnet fallback scan**
   - if mDNS fails, probe likely local subnet hosts for `/rpc/Shelly.GetDeviceInfo`
4. **Selection**
   - pick the first verified endpoint and set `SHELLY_HOST`
5. **Only then ask user**
   - ask for manual host/IP only if automated discovery fails within a reasonable timeout

Do not skip auto-discovery when running in same-LAN conditions.

## Telemetry Mapping

Shelly RPC call:

- `GET /rpc/Switch.GetStatus?id=0`

Publish topic:

- `telemetry.switch_status`

Payload fields:

- `output`
- `apower_w`
- `voltage_v`
- `current_a`
- `energy_total`
- `temperature_c`

## Command Mapping

Read command envelopes from SmartClaws `INCOMING_CHANNEL`.

Supported topic:

- `command.switch.set`

Payload schema:

```json
{ "on": true, "toggle_after": 0 }
```

Execution:

- call `/rpc/Switch.Set?id=0&on=<bool>[&toggle_after=<n>]`

Ignore unknown topics.

## Runtime Steps

1. Auto-discover `SHELLY_HOST` (or use override if provided), then validate with `Shelly.GetDeviceInfo`.
2. Validate SmartClaws device exists locally.
3. Start loop:
   - pull status from Shelly and publish telemetry
   - read command channel (`smartclaws read --channel ... --json`)
   - apply new commands only (track last offset)
4. Persist last command offset for replay safety.

## Reference Implementation

Use:

- `skills/smartclaws-shelly-plug-s-gen3/examples/shelly-plug-s-gen3-publisher.py`

## Validation

- Agent discovers Shelly endpoint autonomously on same-LAN setups.
- Telemetry appears on outgoing channel continuously.
- A published `command.switch.set` changes physical relay state.
- Restart does not replay old command offsets.
