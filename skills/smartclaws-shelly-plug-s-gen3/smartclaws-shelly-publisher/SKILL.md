---
name: smartclaws-shelly-publisher
description: >
  Operate the dumb edge bridge for Shelly Plug S Gen3: discover the device,
  read telemetry on demand, publish to SmartClaws on demand or in a loop,
  and check the incoming channel for commands — applying valid switch commands
  to the physical relay.
license: LGPL-3.0-or-later
compatibility: Requires Python 3.10+, requests, and smartclaws CLI
metadata:
  openclaw:
    emoji: "\U0001F4E1"
    homepage: https://github.com/skalenetwork/smartclaws
    requires:
      bins: ["python3", "smartclaws", "openclaw", "ip"]
---

# SmartClaws Shelly Publisher (Edge Bridge)

Device bundle: `skills/smartclaws-shelly-plug-s-gen3`
Reference: `skills/smartclaws-shelly-plug-s-gen3/reference.md`

This is **Agent 1** (dumb bridge). It does not make policy decisions.

Operate interactively. Wait for operator instructions between each action.
Never enable autonomous scheduling without being told to.
When processing valid `command.switch.set` commands, execute them without per-command confirmation.

If you were launched by another OpenClaw agent, that parent agent is only the
orchestrator. Treat this skill as your own operating contract. Do the device
preflight, discovery, telemetry publishing, and command application yourself.

---

## Startup — Discover the Shelly

On first load, read the reference file in full, verify the SmartClaws publisher
setup, and then attempt to find the Shelly Plug S Gen3 on the local network.
Do not wait for the operator to ask.

### HTTP RPC method

Use Python `requests` for all Shelly HTTP RPC calls. Do not choose between
`curl`, browser requests, or ad hoc shell tools. Use query parameters so booleans
and `toggle_after` are encoded consistently.

Unauthenticated call pattern:

```bash
python3 - <<'PY'
import json, os, requests
host = os.environ["SHELLY_HOST"]
r = requests.get(f"http://{host}/rpc/Switch.GetStatus", params={"id": 0}, timeout=5)
r.raise_for_status()
print(json.dumps(r.json()))
PY
```

Authenticated call pattern after the operator provides credentials:

```bash
python3 - <<'PY'
import json, os, requests
from requests.auth import HTTPDigestAuth
host = os.environ["SHELLY_HOST"]
user = os.environ["SHELLY_USER"]
password = os.environ["SHELLY_PASSWORD"]
r = requests.get(
    f"http://{host}/rpc/Switch.GetStatus",
    params={"id": 0},
    auth=HTTPDigestAuth(user, password),
    timeout=5,
)
r.raise_for_status()
print(json.dumps(r.json()))
PY
```

For `Switch.Set`, build Python params as `{"id": 0, "on": True|False}` and include
`"toggle_after": <seconds>` only when provided. This is equivalent to
`/rpc/Switch.Set?id=0&on=false&toggle_after=30`.

### Discovery order

1. **mDNS** — use Python `zeroconf` when installed; otherwise try `avahi-browse`, then `dns-sd`. Look for `_shelly._tcp` and `_http._tcp`, prioritize hostnames matching `shellyplugsg3-*.local`. If no mDNS tool is available, append a warning event and continue to subnet scan.
2. **Verify** — probe each candidate with `/rpc/Shelly.GetDeviceInfo` using Python `requests`, accept only responses with `gen: 3` and Plug S family model.
3. **Subnet scan** — collect all global IPv4 subnets from `ip -o -4 addr show scope global` (handles multi-homed hosts). For each subnet, first probe hosts already in the ARP cache (`ip neigh show`) — these are instant hits. Then parallel-scan remaining hosts (50 concurrent workers, 1 s timeout each). Cap any subnet wider than `/24` to a `/24` anchored on the interface address; respect subnets narrower than `/24` as-is. Stop as soon as any host returns `gen: 3` and a Plug S model.
4. **Ask operator** — only if all automated discovery fails.

mDNS command patterns when Python `zeroconf` is unavailable:

```bash
avahi-browse -rt _shelly._tcp
avahi-browse -rt _http._tcp
dns-sd -B _shelly._tcp local
dns-sd -B _http._tcp local
```

Any discovered hostname must still pass the Verify step before use.

Subnet scan helper pattern:

```bash
python3 - <<'PY'
import ipaddress, json, subprocess, requests
from concurrent.futures import ThreadPoolExecutor, as_completed

def probe(ip):
    try:
        r = requests.get(f"http://{ip}/rpc/Shelly.GetDeviceInfo", timeout=1)
        if r.ok:
            data = r.json()
            if data.get("gen") == 3 and "Plug" in json.dumps(data):
                return str(ip), data
    except Exception:
        pass
    return None

# Collect all global IPv4 subnets (handles multi-homed hosts)
out = subprocess.check_output(["ip", "-o", "-4", "addr", "show", "scope", "global"], text=True)
subnets = []
for line in out.splitlines():
    parts = line.split()
    if len(parts) < 4:
        continue
    cidr = parts[3]
    net = ipaddress.ip_interface(cidr).network
    if net.prefixlen < 24:
        net = ipaddress.ip_network(f"{ipaddress.ip_interface(cidr).ip}/24", strict=False)
    if net not in subnets:
        subnets.append(net)

if not subnets:
    print("No global IPv4 interfaces found")
    raise SystemExit(1)

# ARP cache first — instant for already-reachable hosts
arp_out = subprocess.check_output(["ip", "neigh", "show"], text=True)
arp_hits = []
for line in arp_out.splitlines():
    if "FAILED" in line or "INCOMPLETE" in line:
        continue
    parts = line.split()
    if not parts:
        continue
    try:
        ip = ipaddress.ip_address(parts[0])
        if any(ip in net for net in subnets):
            arp_hits.append(ip)
    except ValueError:
        pass

for ip in arp_hits:
    result = probe(ip)
    if result:
        host, info = result
        print(json.dumps({"host": host, "device_info": info}))
        raise SystemExit(0)

# Parallel scan of remaining hosts across all subnets
arp_set = set(arp_hits)
candidates = [ip for net in subnets for ip in net.hosts() if ip not in arp_set]
with ThreadPoolExecutor(max_workers=50) as ex:
    futures = {ex.submit(probe, ip): ip for ip in candidates}
    for fut in as_completed(futures):
        result = fut.result()
        if result:
            host, info = result
            print(json.dumps({"host": host, "device_info": info}))
            raise SystemExit(0)

print("No Shelly Plug S Gen3 found by subnet scan")
PY
```

### Report back

Once found (or failed), report clearly:

```
Found: shellyplugsg3-aabbcc.local (192.168.1.50)
  Model:    SNPL-00112EU
  Gen:      3
  Auth:     disabled
  Firmware: 1.4.2

Shelly is reachable. Waiting for instructions.
```

If auth is enabled, ask the operator for credentials before proceeding.

Set `SHELLY_HOST` internally. All subsequent Shelly calls use this endpoint. Immediately persist `shelly_host`, `incoming_channel`, `outgoing_channel`, `device_name`, `registry_address` if known, `last_incoming_offset = -1` when missing, `cron_enabled = false` when missing, and `updated_at` to `STATE_FILE`. Cron must not be enabled until `STATE_FILE.shelly_host` and both channel fields exist.

---

## Required Environment

```
SMARTCLAWS_HOME   path to publisher config dir  (e.g. ~/.sc-publisher)
DEVICE_NAME       SmartClaws device name         (e.g. shelly-plug-s)
INCOMING_CHANNEL  runtime value loaded from STATE_FILE.incoming_channel
STATE_FILE        local state file with channels, Shelly host, offsets         (e.g. ~/.sc-publisher/state/shelly-publisher-state.json)
EVENT_LOG         append-only status events       (e.g. ~/.sc-publisher/state/shelly-publisher-events.jsonl)
EVENT_APPEND      append helper executable        (e.g. ~/.sc-publisher/bin/shelly-log-event)
SMARTCLAWS_BIN    optional path to CLI binary     (e.g. packages/cli/dist/smartclaws)
```

Cron runs use isolated sessions. Do not rely on shell exports from the setup chat. Each cycle must reconstruct runtime values from this skill's Required Environment section and `STATE_FILE`. Treat environment variables as convenient defaults only. Required constants: `SMARTCLAWS_HOME`, `DEVICE_NAME`, `STATE_FILE`, `EVENT_LOG`, `EVENT_APPEND`, and `SMARTCLAWS_BIN` — all defined above. Required runtime values from `STATE_FILE`: `incoming_channel`, `outgoing_channel`, and `shelly_host`.

Confirm these are set and that `smartclaws device list` shows the device before accepting any other instruction. If `SMARTCLAWS_BIN` is provided, use that binary instead of assuming `smartclaws` is on `PATH`.

### SmartClaws CLI output schemas

`smartclaws device list` prints one block per device:

```text
shelly-plug-s
  Contract:  0x...
  Outgoing:  0x...
  Incoming:  0x...
```

Parse channels by exact labels. `Incoming:` is the device command channel and must be persisted as `STATE_FILE.incoming_channel`. `Outgoing:` is the telemetry channel and must be persisted as `STATE_FILE.outgoing_channel`. If the device block or either label is missing, stop and report `device_list_parse_failed`.

`smartclaws publish` success output is:

```text
Published to shelly-plug-s/telemetry.switch_status
  Tx:     0x...
  Status: success
```

Extract `last_telemetry_tx` from the exact `Tx:` line. Require `Status: success`; any other status is a publish failure.

Preflight (run before long loops or cron setup):

```bash
SMARTCLAWS_BIN=${SMARTCLAWS_BIN:-smartclaws}
EVENT_APPEND=${EVENT_APPEND:-~/.sc-publisher/bin/shelly-log-event}
command -v python3
command -v openclaw
command -v ip
command -v "$SMARTCLAWS_BIN" || test -x "$SMARTCLAWS_BIN"
test -x "$EVENT_APPEND"
python3 -c "import requests"
python3 - <<'PY'
import importlib.util, shutil
if importlib.util.find_spec("zeroconf"):
    print("mDNS: python zeroconf available")
elif shutil.which("avahi-browse"):
    print("mDNS: avahi-browse available")
elif shutil.which("dns-sd"):
    print("mDNS: dns-sd available")
else:
    print("mDNS: no local mDNS helper found; subnet scan will be used")
PY
SMARTCLAWS_HOME=~/.sc-publisher "$SMARTCLAWS_BIN" device list
```

If any check fails, stop and report the missing dependency/config before proceeding.

---

## State And Status Events

Use local files for operational continuity and demo observability. This is not
LLM memory: do not store these facts in chat history or rely on remembering them
between turns.

Write durable state to `STATE_FILE`. Keep it small and structured:

```json
{
  "registry_address": "0x...",
  "device_name": "shelly-plug-s",
  "incoming_channel": "0x...",
  "outgoing_channel": "0x...",
  "shelly_host": "192.168.1.50",
  "last_incoming_offset": 12,
  "last_telemetry_tx": "0x...",
  "cron_job_id": "job-...",
  "cron_enabled": true,
  "last_error": null,
  "updated_at": "2026-05-18T12:00:00Z"
}
```

Append compact JSONL status events to `EVENT_LOG`. The dashboard may render
these as agent messages.

Do not read, parse, rewrite, truncate, rotate, or summarize `EVENT_LOG` before
writing an event. Use only the append helper:

```bash
EVENT_APPEND=${EVENT_APPEND:-~/.sc-publisher/bin/shelly-log-event}
EVENT_LOG=${EVENT_LOG:-~/.sc-publisher/state/shelly-publisher-events.jsonl}

EVENT_LOG="$EVENT_LOG" "$EVENT_APPEND" info start "cycle started"
EVENT_LOG="$EVENT_LOG" "$EVENT_APPEND" ok telemetry "published telemetry" \
  '{"tx":"0xabc","power_w":812.4}'
EVENT_LOG="$EVENT_LOG" "$EVENT_APPEND" error publish "publish failed" \
  '{"error":"insufficient funds","full_log":"<dirname(STATE_FILE)>/shelly-publisher-last-error.log"}'
```

The helper appends one JSON object plus newline. The optional fourth argument
must be a small JSON object. Never pass raw command output as JSON details.

Example event shape:

```json
{"agent":"smartclaws-shelly-publisher","level":"ok","message":"published telemetry","power_w":812.4,"stage":"telemetry","ts":"2026-05-18T12:00:03Z","tx":"0xabc"}
```

On verbose failures, write the full details to `shelly-publisher-last-error.log` in the same directory as `STATE_FILE`, store the short summary and full-log path in `STATE_FILE.last_error`, and append one failure event using `EVENT_APPEND`.

---

## Operations

The operator will give instructions in plain language. Map them to the actions below.

---

### Read telemetry

**Trigger:** "read telemetry", "what is the current state", "check the plug"

Call:
```
GET /rpc/Switch.GetStatus?id=0
```

Report all fields clearly:

```
Shelly status:
  Switch:      ON
  Power:       852.3 W
  Voltage:     230.1 V
  Current:     3.70 A
  Energy:      142.4 Wh
  Temperature: 41.5 °C
```

Just read and report.

---

### Publish telemetry (one shot)

**Trigger:** "publish telemetry", "publish one reading", "send to chain"

1. Read from Shelly (`/rpc/Switch.GetStatus?id=0`)
2. Publish to the outgoing channel. Always use `--device`; never use `--channel`. The `--channel` flag bypasses device resolution and publishes with `dev: controller` in the envelope instead of the device name, which corrupts the on-chain record.

```bash
SMARTCLAWS_HOME=~/.sc-publisher "$SMARTCLAWS_BIN" publish \
  --device "$DEVICE_NAME" \
  --topic telemetry.switch_status \
  --data '{"output":<bool>,"apower_w":<float>,"voltage_v":<float>,"current_a":<float>,"energy_total":<float>,"temperature_c":<float>}'
```

3. Report the transaction hash and confirm success.

---

### Publish telemetry in a loop

**Trigger:** "start publishing", "publish every N seconds", "keep publishing"

Ask the operator for the interval if not specified (1 Min).

Repeat on that interval:
1. Read from Shelly
2. Publish to outgoing channel
3. Print one status line per cycle, e.g.:

```
[10:24:01] #0003 | ON | 852.3 W | 230.1 V | tx: 0xabc...
```

Continue until the operator says stop.

---

### Stop

**Trigger:** "stop", "pause", "stop publishing"

Stop the current loop immediately. Report how many cycles completed and the last tx hash.

---

### Start cron autopilot (wake -> check commands -> publish -> exit)

**Trigger:** "enable cron", "run every N seconds", "autopilot every N"

Use OpenClaw cron for unattended periodic execution. This mode is explicit opt-in and must be enabled by operator request.

Session mode default for this skill: use an isolated session targeting this
agent. Do not use the current chat session for recurring work. The live demo
view should read `EVENT_LOG` and `STATE_FILE`; OpenClaw chat delivery is
optional and should not be required.

One Shelly publisher cycle means exactly this, in order:
1. Confirm runtime constants from this skill's Required Environment section: `SMARTCLAWS_HOME`, `DEVICE_NAME`, `STATE_FILE`, `EVENT_LOG`, `EVENT_APPEND`, and `SMARTCLAWS_BIN`.
2. Load `STATE_FILE`. If it is missing, append `state_missing`, fail, and do not rediscover inside cron.
3. Read `incoming_channel` from `STATE_FILE`. If absent, append a `state_incomplete` failed event and stop; do not guess the channel address.
4. Read `shelly_host` and `last_incoming_offset` from `STATE_FILE`. If `shelly_host` is missing, append `state_incomplete` and fail with a concise setup-needed report. `last_incoming_offset` defaults to `-1` if absent.
5. Set `SHELLY_HOST = state.shelly_host` for Shelly HTTP calls and `INCOMING_CHANNEL = state.incoming_channel` for SmartClaws reads.
6. Append a `start` event with `EVENT_APPEND`.
7. Probe the incoming channel without an offset to get `total`, `oldest`, and `latest`.
8. If the probe says `No messages.`, there are no commands; continue to telemetry.
9. If `latest <= last_incoming_offset`, there are no new commands; continue to telemetry.
10. Otherwise read exactly one incoming message at offset `latest`.
11. Treat any unseen offsets before `latest` as superseded by the latest command; append one `superseded_commands` event when `latest > last_incoming_offset + 1`.
12. Apply the latest message only when topic is `command.switch.set` and payload is valid.
13. Append an `applied_command` event when applied, or a `skipped_command` event when the latest message is unknown or malformed.
14. Set `last_incoming_offset = latest` after inspecting the latest message, even if it was skipped.
15. Read current Shelly telemetry from `/rpc/Switch.GetStatus?id=0` using `SHELLY_HOST` from state.
16. Publish one `telemetry.switch_status` message using `--device "$DEVICE_NAME"`; never use `--channel`. Do not require `OUTGOING_CHANNEL` as an environment variable.
17. Persist updated state to `STATE_FILE`, including offset, relay state, latest tx hash, and `updated_at`.
18. Append a compact `done` event, or append one `failed` event if any step fails.
19. Report one concise success/failure summary and exit.

Do not skip telemetry publishing just because there were no incoming commands.
Do not run a continuous loop inside one cron invocation.
Do not rerun discovery inside a cron cycle; if `shelly_host` is missing from `STATE_FILE`, fail and ask the operator to run startup/discovery again.

Notes:
- Autonomous mode has full authority to execute valid `command.switch.set` commands.
- Only apply known command topic `command.switch.set`.
- Reject malformed payloads and log skip reason.

Before creating the cron job, resolve your own agent ID: call `sessions_list`,
find the session whose `kind` is `main`, and read its `agentId`. Use that value
for `--agent` — do not hardcode a name.

Create recurring job (interval provided by operator):

```bash
openclaw cron add \
  --name "shelly-publisher-cycle" \
  --every <interval> \
  --session isolated \
  --agent <your-agentId> \
  --message "Using your injected smartclaws-shelly-publisher skill, run exactly one cron cycle as specified in the cron cycle steps — do not summarise or skip any step." \
  --no-deliver \
  --wake now
```

Recommended `--every` interval: `1m` or `2m`. OpenClaw examples use compact duration strings such as `1m`; do not invent alternate formats unless `openclaw cron --help` confirms them.

After creating the job, persist `cron_job_id` and `cron_enabled` in
`STATE_FILE`, append a `cron_enabled` event to `EVENT_LOG`, and report job
id/name plus next run time.

Stop behavior: operator can remove cron at any time; if a run is currently active, stop applies after that run finishes.

---

### Cron status

**Trigger:** "cron status", "is autopilot running", "show schedule"

Check and report scheduler state:

```bash
openclaw cron list
openclaw cron show <job-id>
```

Report: enabled/disabled, interval, next run, and most recent run result.

---

### Stop cron autopilot

**Trigger:** "stop cron", "disable autopilot", "cancel scheduled run"

Disable autonomous periodic runs by removing the cron job:

```bash
openclaw cron remove <job-id>
```

If job id is unknown, find it first with `openclaw cron list` by matching name `shelly-publisher-cycle`.
Confirm removal by showing `openclaw cron list` output afterward.

---

### Check incoming channel

**Trigger:** "check for commands", "any new commands?", "read incoming"

Load `INCOMING_CHANNEL` from `STATE_FILE.incoming_channel`; do not require it as a shell export. First probe the incoming channel without an offset. This returns channel stats when messages exist and avoids an invalid `offset + 1` read when there are no new messages:

```bash
SMARTCLAWS_HOME=~/.sc-publisher "$SMARTCLAWS_BIN" read \
  --channel <INCOMING_CHANNEL> \
  --limit 1 \
  --json
```

If the probe prints `No messages.`, treat that exact result as an empty channel.
Do not treat other command failures as "no messages".

If the probe returns JSON like this:

```json
{
  "device": null,
  "channel": "0x...",
  "total": 7,
  "oldest": 0,
  "latest": 6,
  "messages": [{ "offset": 6, "v": 1, "ts": 1760000000, "dev": "controller", "topic": "command.switch.set", "p": { "on": true } }]
}
```

Then:
- read `latest`
- if `latest <= last_incoming_offset`, there are no new messages
- otherwise read exactly one message at offset `latest`:

```bash
SMARTCLAWS_HOME=~/.sc-publisher "$SMARTCLAWS_BIN" read \
  --channel <INCOMING_CHANNEL> \
  --offset <latest> \
  --limit 1 \
  --json
```

If `latest > last_incoming_offset + 1`, append one `superseded_commands` event
because older unseen commands no longer matter for the relay's desired on/off
state.

If there is a new latest message, report that message:

```
Latest command since last check:

  [4] from: controller | topic: command.switch.set | {"on": true}
```

If there are no new messages:

```
No new commands. Last checked offset: 2.
```

Update and remember the last read offset after every check.
Execute valid `command.switch.set` commands immediately (no per-command approval).
Persist the updated offset to `STATE_FILE` after each check.

---

### Apply a command to Shelly

**Trigger:** command message with topic `command.switch.set`

Apply immediately after validation (no confirmation prompt).

Execution format. Use Python `requests`; this URL is shown only for reporting:

```
Applying command [offset 3]:
  Topic:   command.switch.set
  Payload: {"on": false, "toggle_after": 30}
  Action:  GET http://192.168.1.50/rpc/Switch.Set?id=0&on=false&toggle_after=30
```

Python call pattern. Substitute `<host>`, `<on>`, and `<toggle_after>` from STATE_FILE and the parsed command payload before running — do not rely on shell env vars in cron:

```bash
python3 - <<PY
import json, requests
from requests.auth import HTTPDigestAuth
host = "<state.shelly_host>"
params = {"id": 0, "on": <payload.on as Python bool: True or False>}
toggle_after = <payload.toggle_after as int, or None if absent>
if toggle_after is not None:
    params["toggle_after"] = toggle_after
auth = None  # add HTTPDigestAuth(user, password) if auth_en
r = requests.get(f"http://{host}/rpc/Switch.Set", params=params, auth=auth, timeout=5)
r.raise_for_status()
print(json.dumps(r.json()))
PY
```

After execution, report the result:

```
Applied. Shelly responded: {"was_on": true, "has_timer": false}
New switch state: OFF
```

---

## State the Agent Must Track

| Variable | Description |
|---|---|
| `SHELLY_HOST` | discovered endpoint, set at startup |
| `incoming_channel` | device incoming channel address |
| `outgoing_channel` | device outgoing channel address |
| `registry_address` | SmartClaws registry address from publisher config |
| `last_incoming_offset` | highest offset read from the incoming channel; start at -1 |
| `last_telemetry_tx` | most recent telemetry publish transaction hash |
| `publishing_active` | whether a publish loop is currently running |
| `cron_job_id` | OpenClaw cron job id for autopilot cycle (if enabled) |
| `cron_enabled` | whether recurring autopilot cron is currently enabled |
| `last_error` | short error summary and full-log path when a cycle fails |

---

## What This Agent Never Does

- Does not decide when to turn the relay on or off
- Does not apply unknown command topics
- Does not apply malformed command payloads
- Does not enable, edit, or remove cron schedules unless the operator explicitly asks
- Does not publish continuously without being told to
- Does not make any policy decisions

---

## Telemetry Payload Schema

```json
{
  "output":        true,
  "apower_w":      852.3,
  "voltage_v":     230.1,
  "current_a":     3.70,
  "energy_total":  142.4,
  "temperature_c": 41.5
}
```

Topic: `telemetry.switch_status`

---

## Command Payload Schema

Topic: `command.switch.set`

```json
{ "on": true, "toggle_after": 0 }
```

Validation rules:
- `on` is required and must be a JSON boolean `true` or `false`; reject strings such as `"true"`, numbers, null, and missing values.
- `toggle_after` is optional. If present, it must be a non-negative integer number of seconds; reject strings, floats, negative values, and null.
- Reject any payload with unknown required intent or malformed JSON.
- Extra fields are ignored only after the required fields above validate.

Schema fields:
- `on` — required boolean
- `toggle_after` — optional non-negative integer seconds before Shelly auto-reverses
