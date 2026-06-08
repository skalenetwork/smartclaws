#!/usr/bin/env python3
"""
Thermal Sensor Simulator — SmartClaws dev tool

Acts as a second "dumb" device agent. There is no real temperature sensor;
this script simulates one whose reading is causally linked to the Shelly
relay state read from the chain.

Each tick:
  1. Read latest telemetry from SHELLY_OUTGOING_CHANNEL to find the current
     relay output (true/false).
  2. Advance the internal thermal model:
       - When the relay is ON  -> temperature rises toward T_ASYMP_ON.
       - When the relay is OFF -> temperature decays toward AMBIENT_C.
  3. Publish telemetry.thermal_status to its own outgoing channel under its
     own device name.

The publish path mirrors smartclaws-shelly-publisher: telemetry is published
via `smartclaws publish --device <DEVICE_NAME>`, never `--channel`.

Required env vars:
  SMARTCLAWS_HOME             path to thermal agent config dir (e.g. ~/.sc-thermal)
  DEVICE_NAME                 smartclaws device name (e.g. thermal-sensor-1)
  SHELLY_OUTGOING_CHANNEL     channel to read relay state from (0x...)

Optional env vars:
  POLL_SECONDS                publish interval in seconds (default: 5)
  AMBIENT_C                   resting temperature (default: 20.0)
  T_ASYMP_ON                  asymptote when relay ON (default: 32.0)
  TAU_HEAT_S                  heating time constant in seconds (default: 90)
  TAU_COOL_S                  cooling time constant in seconds (default: 180)
  NOISE_C                     gaussian stddev on each reading (default: 0.08)
  STALE_RELAY_MAX_S           how stale relay-state reads may be before we
                              flag staleness in payload (default: 30)
  INITIAL_TEMP_C              starting temperature (default: AMBIENT_C)
  SMARTCLAWS_BIN              path to smartclaws binary (default: smartclaws)
  STATE_FILE                  thermal sim state file
                              (default: $SMARTCLAWS_HOME/thermal-sim.state.json)
  PRINT_STATUS                "1" to print one status line per tick (default: 1)
"""

import json
import math
import os
import random
import subprocess
import sys
import time
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SC_HOME = os.environ.get("SMARTCLAWS_HOME", os.path.expanduser("~/.sc-thermal"))
DEVICE_NAME = os.environ.get("DEVICE_NAME", "thermal-sensor-1")
SHELLY_OUT = os.environ.get("SHELLY_OUTGOING_CHANNEL", "")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "120"))
# Slow, demo-friendly curve: stays within 20-29C, surfs ~22-24C over ~40-60 min.
# Asymptotes bracket the desired range so it never overshoots the hard bounds;
# large time constants keep the trend gentle (~0.05-0.15 C/min near the band).
AMBIENT_C = float(os.environ.get("AMBIENT_C", "21.0"))      # cooling floor (relay OFF target)
T_ASYMP_ON = float(os.environ.get("T_ASYMP_ON", "27.0"))    # heating ceiling (relay ON target)
TAU_HEAT_S = float(os.environ.get("TAU_HEAT_S", "2400"))    # ~40 min heating time constant
TAU_COOL_S = float(os.environ.get("TAU_COOL_S", "3000"))    # ~50 min cooling time constant
NOISE_C = float(os.environ.get("NOISE_C", "0.05"))
STALE_RELAY_MAX_S = float(os.environ.get("STALE_RELAY_MAX_S", "300"))
INITIAL_TEMP_C = float(os.environ.get("INITIAL_TEMP_C", "23.0"))  # mid-band start (only used if no state)
SMARTCLAWS = os.environ.get("SMARTCLAWS_BIN", "smartclaws")
STATE_FILE = os.environ.get(
    "STATE_FILE", os.path.join(SC_HOME, "thermal-sim.state.json")
)
PRINT_STATUS = os.environ.get("PRINT_STATUS", "1") == "1"

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "temp_c": INITIAL_TEMP_C,
            "last_temp_c": INITIAL_TEMP_C,
            "last_relay_state": None,
            "last_relay_seen_ts": None,
        }


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    os.replace(tmp, STATE_FILE)


# ---------------------------------------------------------------------------
# Shelly state read (off-chain via smartclaws CLI)
# ---------------------------------------------------------------------------

def read_latest_relay_state() -> tuple[bool | None, float | None]:
    """Return (output_bool_or_None, message_ts_or_None) from latest shelly telemetry."""
    if not SHELLY_OUT:
        return None, None
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    result = subprocess.run(
        [SMARTCLAWS, "read", "--channel", SHELLY_OUT, "--limit", "5", "--json"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  [WARN] read shelly channel failed: {result.stderr.strip()}",
              file=sys.stderr)
        return None, None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None, None
    msgs = data.get("messages") or []
    # Walk newest-first looking for a telemetry.switch_status with `output`.
    for m in sorted(msgs, key=lambda x: x.get("offset", -1), reverse=True):
        if m.get("topic") == "telemetry.switch_status":
            p = m.get("p") or {}
            out = p.get("output")
            if isinstance(out, bool):
                return out, float(m.get("ts") or 0) or None
    return None, None


# ---------------------------------------------------------------------------
# Thermal model
# ---------------------------------------------------------------------------

def step_temperature(
    current_temp: float,
    relay_on: bool | None,
    dt_seconds: float,
) -> float:
    """Advance temperature by dt seconds under a first-order thermal model.

    relay_on=None means we don't know the relay state — assume OFF (safer for
    a heat-mat scenario: we don't randomly heat without proof).
    """
    if relay_on:
        target = T_ASYMP_ON
        tau = TAU_HEAT_S
    else:
        target = AMBIENT_C
        tau = TAU_COOL_S
    # Exact solution of dT/dt = (target - T) / tau over dt
    decay = math.exp(-dt_seconds / tau)
    return target + (current_temp - target) * decay


# ---------------------------------------------------------------------------
# SmartClaws publish
# ---------------------------------------------------------------------------

def publish_thermal(payload: dict) -> bool:
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    result = subprocess.run(
        [SMARTCLAWS, "publish", "--device", DEVICE_NAME,
         "--topic", "telemetry.thermal_status",
         "--data", json.dumps(payload)],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  [ERR] publish thermal failed: {result.stderr.strip()}",
              file=sys.stderr)
        return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def banner(state: dict) -> None:
    print("=" * 60)
    print("  SmartClaws Thermal Sensor Simulator")
    print("=" * 60)
    print(f"  Device:        {DEVICE_NAME}")
    print(f"  Shelly chan:   {SHELLY_OUT or '(not set — relay state unknown)'}")
    print(f"  Ambient:       {AMBIENT_C:.1f} C")
    print(f"  T_asymp_on:    {T_ASYMP_ON:.1f} C")
    print(f"  tau heat:      {TAU_HEAT_S:.0f} s")
    print(f"  tau cool:      {TAU_COOL_S:.0f} s")
    print(f"  Interval:      {POLL_SECONDS} s")
    print(f"  Start temp:    {state['temp_c']:.2f} C")
    print("=" * 60)
    print()


def main() -> None:
    if not SHELLY_OUT:
        print("WARN: SHELLY_OUTGOING_CHANNEL not set. The simulator will assume "
              "relay is OFF and decay toward ambient.", file=sys.stderr)

    state = load_state()
    banner(state)

    tick = 0
    last_wall = time.time()

    while True:
        tick += 1
        now_wall = time.time()
        dt = max(0.001, now_wall - last_wall)
        last_wall = now_wall

        relay_on, relay_ts = read_latest_relay_state()
        if relay_on is not None:
            state["last_relay_state"] = relay_on
            state["last_relay_seen_ts"] = now_wall
        used_relay = state.get("last_relay_state")
        stale_for = (now_wall - state["last_relay_seen_ts"]) if state.get("last_relay_seen_ts") else None

        prev_temp = state["temp_c"]
        new_temp = step_temperature(prev_temp, used_relay, dt)
        # Per-minute trend computed from this step
        trend_per_min = (new_temp - prev_temp) * (60.0 / dt)
        # Reading exposed to consumers includes sensor noise; internal model
        # state stays clean.
        reading = new_temp + random.gauss(0.0, NOISE_C)

        state["last_temp_c"] = prev_temp
        state["temp_c"] = new_temp
        save_state(state)

        payload = {
            "temperature_c": round(reading, 2),
            "trend_c_per_min": round(trend_per_min, 3),
            "ambient_c": round(AMBIENT_C, 1),
            "relay_state": used_relay,
            "stale_relay_seconds": round(stale_for, 1) if stale_for is not None else None,
            "stale_relay": (
                stale_for is None or stale_for > STALE_RELAY_MAX_S
            ),
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

        ok = publish_thermal(payload)

        if PRINT_STATUS:
            ts = time.strftime("%H:%M:%S")
            relay_str = "ON " if used_relay else ("OFF" if used_relay is False else "??? ")
            print(
                f"[{ts}] #{tick:05d} | relay {relay_str} | "
                f"T={reading:5.2f} C | trend={trend_per_min:+.3f} C/min | "
                f"{'ok' if ok else 'PUBLISH FAILED'}"
            )

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped.")
