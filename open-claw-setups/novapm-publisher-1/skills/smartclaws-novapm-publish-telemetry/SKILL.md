---
name: smartclaws-novapm-publish-telemetry
description: >
  Read the SDS011 Nova PM sensor via USB serial and publish the PM2.5 and PM10
  measurements on-chain to the NovaPM outgoing channel. Handles sensor wake,
  warmup, read, sleep, validation, and on-chain publish. Mutating — signs a
  transaction. Never called unless a good reading was obtained.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "📡"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws NovaPM Air Quality Sensor — Read Sensor & Publish Telemetry

Read the SDS011 sensor and write one PM2.5/PM10 measurement on-chain. This
skill is **mutating**: it wakes real hardware, reads it, sleeps it again, and
signs an on-chain transaction. Call it only when a fresh reading is needed.

Paths, channel address, and binary are the fixed constants in `AGENTS.md`.
Sensor constants (`SENSOR_PORT`, `SENSOR_WARMUP_S`) come from `AGENTS.md`. Use
those — do not invent addresses or override sensor parameters.

---

## Step 1 — Get sensor parameters from AGENTS.md

`SENSOR_PORT` and `SENSOR_WARMUP_S` are fixed constants in `AGENTS.md` — use
those values exactly as set during boot. Do not read any other file for these.

If `SENSOR_WARMUP_S` is somehow below 15 (misconfiguration), clamp it to 15
and note the clamp in the cycle log.

---

## Step 2 — Read the SDS011

#### 2a. Check Python library

The sensor is read using `pyserial` (no third-party sensor library needed). Verify
it is available:

```bash
python3 -c "import serial; print('ok')"
```

If it prints an error, install it:

```bash
sudo apt install python3-serial
```

Do not attempt to install it yourself. Do not continue without it.

#### 2b. Run the sensor snippet

Uses `pyserial` directly with the SDS011 serial protocol. Wake, warmup, read one
frame, sleep. No external sensor library required.

```bash
python3 - <<'PYEOF'
import sys, time, json, struct

PORT   = "/dev/ttyUSB0"  # SENSOR_PORT from AGENTS.md
WARMUP = 30              # SENSOR_WARMUP_S from AGENTS.md

# SDS011 sleep/wake commands (from datasheet)
WAKE_CMD  = bytes([0xAA,0xB4,0x06,0x01,0x01,0x00,0x00,0x00,0x00,
                   0x00,0x00,0x00,0x00,0x00,0x00,0xFF,0xFF,0x06,0xAB])
SLEEP_CMD = bytes([0xAA,0xB4,0x06,0x01,0x00,0x00,0x00,0x00,0x00,
                   0x00,0x00,0x00,0x00,0x00,0x00,0xFF,0xFF,0x05,0xAB])

def read_frame(ser):
    """Read one valid 10-byte measurement frame from the sensor."""
    ser.flushInput()
    for _ in range(300):  # up to ~30s of attempts
        if ser.read(1) == b'\xaa':
            rest = ser.read(9)
            if (len(rest) == 9 and rest[0] == 0xc0 and rest[8] == 0xab
                    and (sum(rest[1:7]) & 0xFF) == rest[7]):
                pm25 = struct.unpack('<H', rest[1:3])[0] / 10.0
                pm10 = struct.unpack('<H', rest[3:5])[0] / 10.0
                return pm25, pm10
    raise RuntimeError("No valid frame received after warmup")

try:
    import serial
except ImportError:
    print(json.dumps({"ok": False, "error": "pyserial not installed — run: sudo apt install python3-serial"}))
    sys.exit(1)

try:
    ser = serial.Serial(PORT, 9600, timeout=2)
    ser.write(WAKE_CMD)
    time.sleep(0.5)
    time.sleep(WARMUP)          # warm up — fan must stabilise before reading
    pm25, pm10 = read_frame(ser)
    ser.write(SLEEP_CMD)        # back to sleep — protect fan lifespan
    time.sleep(0.1)
    ser.close()
    print(json.dumps({"pm25": round(pm25, 1), "pm10": round(pm10, 1), "ok": True}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
PYEOF
```

Parse the JSON output. If `ok` is `false` or the script exits non-zero:

- **Do not publish.**
- Return the error to the master cycle. Do **not** call `smartclaws-publish-decisions` here — the master cycle handles all on-chain logging and continuation with `pm25 = null`, `pm10 = null`, `telemetry_tx = null`.

### Sanity check — reject implausible readings

Before publishing, validate the values:

| Check | Condition to reject |
|---|---|
| PM2.5 out of range | `pm25 < 0` or `pm25 > 1000` |
| PM10 out of range  | `pm10 < 0` or `pm10 > 1000` |
| PM2.5 > PM10       | `pm25 > pm10` (physically impossible for SDS011) |

If any check fails: **discard, log the anomaly, do not publish.** Do not
attempt to "fix" the value — bad data is worse than no data.

---

## Step 3 — Sign, then publish on-chain

Write to `NOVAPM_OUTGOING_CHANNEL`. Use `--from controller`. **Every publish is
signed first** — follow `smartclaws-pairpoint-signing`. Build the reading
payload, sign it into an envelope, then publish the *envelope*.

Build the reading JSON from the sensor read:

```json
{
  "pm25_ug_m3": <pm25 value>,
  "pm10_ug_m3": <pm10 value>,
  "sensor": "sds011",
  "port": "<SENSOR_PORT>",
  "ts": "<ISO 8601 UTC timestamp of the reading>"
}
```

Sign it, capturing the signed envelope, then publish that:

```bash
SIGNED=$(printf '%s' '{"pm25_ug_m3": 12.3, "pm10_ug_m3": 28.1, "sensor": "sds011", "port": "/dev/ttyUSB0", "ts": "2026-06-17T10:00:00Z"}' \
  | python3 ~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py sign)

# If $SIGNED is {"ok":false,...} the signer failed — DO NOT publish. Fail loud.

SMARTCLAWS_HOME=~/.openclaw/workspace/controller \
  ~/.openclaw/workspace/bin/smartclaws publish \
  --channel 0x336F128b054cA0137e2842abe2302099493BFf80 \
  --from controller \
  --topic telemetry.air_quality \
  --data "$SIGNED"
```

The published payload is the signed envelope `{"sig":{...,"body":"..."}}` — the
raw reading rides inside `sig.body`. See `smartclaws-pairpoint-signing` for the
envelope shape and why the reading is transported as a signed string (it makes
verification independent of how the CLI serializes numbers).

**If signing fails, treat it exactly like a failed publish:** do not write
anything on-chain, return the error to the master cycle so it logs the failure.

### Successful publish output

```
Published controller/telemetry.air_quality to channel 0x...
  Tx:     0xabc123...
  Status: success
```

Capture the `Tx:` line. Return it to the caller (the master cycle) so it can
be included in the decision log. The explorer link prefix is:
`https://base-sepolia-testnet-explorer.skalenodes.com/tx/`

If publish fails: **fail loud** — say it failed and surface the CLI error.
Do not claim the reading was published.

---

## After publishing

- The transaction records the reading permanently on-chain.
- Do not re-send the same reading repeatedly. One publish per read cycle.
- To verify the reading landed, use `smartclaws-novapm-read` on the next cycle.
