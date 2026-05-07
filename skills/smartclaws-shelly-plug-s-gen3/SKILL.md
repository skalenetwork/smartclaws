---
name: smartclaws-shelly-plug-s-gen3
description: >
  Publish telemetry from Shelly Plug S Gen3 (Type F) to SmartClaws and apply
  on-chain switch commands back to the plug via Shelly RPC. Use when setting up
  a real Shelly Plug S Gen3 device for SmartClaws producer + actuator workflows.
license: LGPL-3.0-or-later
compatibility: Requires Python 3.10+, requests, and smartclaws CLI
metadata:
  openclaw:
    emoji: "\U0001F50C"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["python3", "smartclaws"]
---

# SmartClaws Shelly Plug S Gen3

This skill configures a real Shelly Plug S Gen3 (Type F) as a SmartClaws device producer and command consumer.

## Real Hardware Rule

Treat this as a real-device workflow by default. Do not publish simulated telemetry unless the user explicitly asks for a simulation.

## Prerequisites

- Shelly Plug S Gen3 (Type F) connected to the same LAN as the host.
- Host has `python3` and SmartClaws CLI installed.
- Python dependency:
  - `pip install requests`
- SmartClaws initialized and funded:
  - `smartclaws init`
  - `smartclaws wallet info`
  - fund wallet with sFUEL/CREDITS as required by target chain
- Device registered in SmartClaws:
  - `smartclaws register`
  - `smartclaws device register --name shelly-plug-s`

Collect these values before running publisher:

- `SHELLY_HOST` (IP or mDNS host, e.g. `192.168.1.50` or `shellyplugsg3-<id>.local`)
- `DEVICE_NAME` (SmartClaws local device name)
- `OUTGOING_CHANNEL` and `INCOMING_CHANNEL` from local device file
- Optional auth credentials if device auth is enabled

## Setup and Registration

1. Confirm the device is reachable:

```bash
curl "http://<SHELLY_HOST>/rpc/Shelly.GetDeviceInfo"
```

2. Validate generation/model from response (`gen: 3`, Plug S Gen3 app/model family).

3. Check authentication mode:
   - inspect `auth_en` from `Shelly.GetDeviceInfo`
   - if enabled, use credentials in all requests

4. Register SmartClaws device (if not already):

```bash
smartclaws device register --name shelly-plug-s
```

5. Read the local device file at `~/.smartclaws/devices/shelly-plug-s.json` and capture:
   - `incomingChannel`
   - `outgoingChannel`

## Device-Specific Protocol Notes

Shelly Plug S Gen3 uses Gen2+/Gen3 JSON-RPC over local HTTP.

- Telemetry/status method:
  - `Switch.GetStatus` with `id=0`
  - endpoint example: `/rpc/Switch.GetStatus?id=0`
- Actuation method:
  - `Switch.Set` with `id=0` and `on=<bool>`
  - endpoint example: `/rpc/Switch.Set?id=0&on=true`
- Core fields from `Switch.GetStatus` used by this skill:
  - `output` (bool)
  - `apower` (W)
  - `voltage` (V)
  - `current` (A)
  - `aenergy.total` (Wh-like total reported by Shelly status payload)
  - `temperature.tC` (C) when available

Suggested SmartClaws topics:

- Outgoing telemetry:
  - `telemetry.switch_status`
- Incoming commands:
  - `command.switch.set`

`command.switch.set` payload schema:

```json
{
  "on": true,
  "toggle_after": 0
}
```

Where:
- `on` is required boolean
- `toggle_after` is optional seconds for Shelly auto flip-back behavior

## Script Structure

Use `examples/shelly-plug-s-gen3-publisher.py` as reference.

Behavior:

1. Poll Shelly `Switch.GetStatus` every N seconds.
2. Publish status payload to SmartClaws topic `telemetry.switch_status`.
3. Poll SmartClaws incoming channel for commands using `smartclaws read --channel ... --json`.
4. For each new `command.switch.set`, call Shelly `Switch.Set`.
5. Track last processed offset to avoid duplicate command execution.
6. Keep running with retry/backoff on transient network errors.

## Publishing Telemetry

Manual single publish check:

```bash
smartclaws publish \
  --device shelly-plug-s \
  --topic telemetry.switch_status \
  --data '{"output":false,"apower":0,"voltage":230.1,"current":0.0}'
```

Expected result: transaction success and readable message on device outgoing channel.

## Handling Incoming Commands

Read commands from device incoming channel:

```bash
smartclaws read --channel <INCOMING_CHANNEL> --limit 20 --json
```

Expected command envelope:

```json
{
  "v": 1,
  "dev": "master-agent",
  "topic": "command.switch.set",
  "p": { "on": true, "toggle_after": 0 }
}
```

Command execution mapping:

- `topic == "command.switch.set"`:
  - validate payload
  - invoke `Switch.Set?id=0&on=<bool>[&toggle_after=<n>]`

Ignore unknown topics safely and log them.

## Validation and Test Plan

1. **Connectivity**
   - `curl /rpc/Shelly.GetDeviceInfo` succeeds.
2. **Status read**
   - `curl /rpc/Switch.GetStatus?id=0` returns JSON with `output` and power fields.
3. **Switch control**
   - call `Switch.Set` on/off and verify `output` changes.
4. **SmartClaws publish**
   - run publisher loop and confirm messages appear:
     - `smartclaws read --device shelly-plug-s --limit 5 --json`
5. **Incoming command path**
   - publish command to incoming channel from another process.
   - verify plug state changes and offset is not reprocessed.

Acceptance criteria:

- Telemetry publishes continuously for 10+ minutes without crash.
- At least one on-chain command toggles the physical relay successfully.
- No duplicate command application after restart when offset persistence is enabled.

## Failure Modes and Recovery

- Shelly unreachable:
  - backoff and retry; keep process alive.
- RPC auth failure:
  - verify credentials and `auth_en` state.
- SmartClaws publish failure:
  - log stderr; retry next interval.
- Malformed command payload:
  - skip command, log validation error.
- Command replay risk:
  - persist last handled offset to local state file.

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `Connection refused` to Shelly | Wrong host/IP or device offline | Verify LAN IP, power, and Wi-Fi association |
| `401 Unauthorized` on RPC | Auth enabled but no/invalid credentials | Provide valid admin credentials |
| `No device group registered` | SmartClaws not initialized/registered | Run `smartclaws init` then `smartclaws register` |
| `Device 'shelly-plug-s' not found` | Device not locally registered | Run `smartclaws device register --name shelly-plug-s` |
| Command applied repeatedly | Offset not tracked | Persist and restore last processed offset |

## References

- Shelly Plug S Gen3 docs
- Shelly Switch component RPC docs
- Shelly RPC protocol docs
