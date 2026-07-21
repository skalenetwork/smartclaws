#!/usr/bin/env python3
"""
Shelly Plug S Gen3 Simulator — SmartClaws dev tool

Publishes fake but realistic telemetry to the device outgoing channel every
POLL_SECONDS seconds. Also polls the device incoming channel and logs what
the real bridge would do for each command it finds.

Run from this repo after registering/funding the Shelly bridge HOME:

  SMARTCLAWS_HOME="$HOME/.smartclaws-demo/shelly-bridge" \
  DEVICE_NAME="shelly-plug-s" \
  INCOMING_CHANNEL="0x..." \
  AGENT_NAME="shelly-bridge-1" \
  AGENT_LOG_ENABLED=1 \
  AGENT_LOG_CYCLES=0 \
  python3 dev/shelly-sim.py

Dependencies:
  - Python 3.10+
  - `smartclaws` CLI on PATH, or SMARTCLAWS_BIN set
  - SMARTCLAWS_HOME initialized as bridge-agent and attached to DEVICE_NAME
  - bridge wallet funded with sFUEL/CREDITS
  - bridge wallet granted publisher on DEVICE_NAME
  - optional agent logs require AGENT_NAME and publisher permission on that agent

Required env vars:
  SMARTCLAWS_HOME     path to the publisher agent config dir (e.g. ~/.sc-publisher)
  DEVICE_NAME         local smartclaws device name (e.g. shelly-plug-s)
  INCOMING_CHANNEL    device incoming channel address (0x...)

Optional env vars:
  POLL_SECONDS        telemetry publish interval in seconds (default: 5)
  SMARTCLAWS_BIN      path to smartclaws binary (default: smartclaws)
  STATE_FILE          path to persist last-command offset (default: $SMARTCLAWS_HOME/shelly-sim.state.json)
  AGENT_NAME          local agent name/address for bridge audit logs
  AGENT_LOG_ENABLED   "1" to publish bridge failure/command logs (default: 0)
  AGENT_LOG_CYCLES    "1" to publish bridge.cycle every tick (default: 0)
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
# Config from environment
# ---------------------------------------------------------------------------

SC_HOME = os.environ.get("SMARTCLAWS_HOME", os.path.expanduser("~/.sc-publisher"))
DEVICE_NAME = os.environ.get("DEVICE_NAME", "shelly-plug-s")
INCOMING_CHANNEL = os.environ.get("INCOMING_CHANNEL", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
SMARTCLAWS = os.environ.get("SMARTCLAWS_BIN", "smartclaws")
STATE_FILE = os.environ.get("STATE_FILE", os.path.join(SC_HOME, "shelly-sim.state.json"))
AGENT_NAME = os.environ.get("AGENT_NAME", "")
AGENT_LOG_ENABLED = os.environ.get("AGENT_LOG_ENABLED", "0") == "1"
AGENT_LOG_CYCLES = os.environ.get("AGENT_LOG_CYCLES", "0") == "1"


# ---------------------------------------------------------------------------
# State persistence (survives restarts, avoids replaying commands)
# ---------------------------------------------------------------------------

def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {"last_command_offset": -1, "output": True, "energy_total_wh": 140.0}
    except Exception:
        return {"last_command_offset": -1, "output": True, "energy_total_wh": 140.0}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


# ---------------------------------------------------------------------------
# Fake telemetry generation
# ---------------------------------------------------------------------------

def fake_telemetry(state: dict, tick: int) -> dict:
    """Return plausible Shelly Switch.GetStatus values."""
    output = state.get("output", True)

    # Simulate a resistive load (~850 W when on, near-zero when off)
    base_power = 850.0
    if output:
        # Slight slow drift + gaussian noise makes it look like a real measurement
        drift = 15.0 * math.sin(tick * 0.1)
        apower = max(0.0, base_power + drift + random.gauss(0, 12))
    else:
        apower = max(0.0, random.gauss(0.3, 0.1))  # standby draw

    voltage = random.gauss(230.0, 1.2)
    current = apower / voltage if voltage > 0 else 0.0

    # Energy accumulates over time when on
    wh_per_tick = (apower * POLL_SECONDS) / 3600.0
    state["energy_total_wh"] = state.get("energy_total_wh", 140.0) + wh_per_tick
    save_state(state)

    return {
        "output": output,
        "apower_w": round(apower, 2),
        "voltage_v": round(voltage, 2),
        "current_a": round(current, 3),
        "energy_total": round(state["energy_total_wh"], 3),
        "temperature_c": round(random.gauss(41.5 if output else 32.0, 1.5), 1),
    }


# ---------------------------------------------------------------------------
# SmartClaws I/O helpers
# ---------------------------------------------------------------------------

def publish_telemetry(topic: str, payload: dict) -> bool:
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    result = subprocess.run(
        [SMARTCLAWS, "publish", "--device", DEVICE_NAME, "--topic", topic,
         "--data", json.dumps(payload)],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  [ERR] publish failed: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def publish_agent_log(topic: str, payload: dict) -> bool:
    """Publish an optional bridge/audit log to this bridge agent's outgoing channel."""
    if not AGENT_LOG_ENABLED or not AGENT_NAME:
        return False
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    body = {
        "device": DEVICE_NAME,
        "script": "shelly-sim.py",
        **payload,
        "ts": payload.get("ts") or now_iso(),
    }
    result = subprocess.run(
        [
            SMARTCLAWS,
            "agent",
            "publish",
            "--agent",
            AGENT_NAME,
            "--topic",
            topic,
            "--data",
            json.dumps(body),
            "--from",
            AGENT_NAME,
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(f"  [WARN] publish agent log failed: {result.stderr.strip()[:200]}",
              file=sys.stderr)
        return False
    return True


def read_incoming() -> dict | None:
    if not INCOMING_CHANNEL:
        return None
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    result = subprocess.run(
        [SMARTCLAWS, "read", "--channel", INCOMING_CHANNEL, "--limit", "20", "--json"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  [ERR] read incoming failed: {result.stderr.strip()}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Command handling — no real hardware, just log what would happen
# ---------------------------------------------------------------------------

def handle_command(envelope: dict, state: dict) -> str:
    topic = envelope.get("topic", "")
    payload = envelope.get("p", {})
    sender = envelope.get("dev", "unknown")
    offset = envelope.get("offset", "?")

    print()
    print(f"  ┌─ COMMAND received [offset {offset}] from '{sender}'")
    print(f"  │  topic: {topic}")
    print(f"  │  payload: {json.dumps(payload)}")

    if topic == "command.switch.set":
        desired_on = payload.get("on")
        toggle_after = payload.get("toggle_after")

        if not isinstance(desired_on, bool):
            print(f"  └─ [SKIP] invalid 'on' field: {desired_on!r}")
            publish_agent_log(
                "bridge.command_skipped",
                {
                    "event": "command_skipped",
                    "offset": offset,
                    "sender": sender,
                    "topic": topic,
                    "reason": "invalid_on",
                    "value": desired_on,
                },
            )
            return "skipped"

        state["output"] = desired_on
        save_state(state)

        rpc_url = f"http://<SHELLY_HOST>/rpc/Switch.Set?id=0&on={'true' if desired_on else 'false'}"
        if toggle_after:
            rpc_url += f"&toggle_after={int(toggle_after)}"

        print(f"  │  → Would call: GET {rpc_url}")
        print(f"  └─ [SIM] Relay is now {'ON 🟢' if desired_on else 'OFF 🔴'}")
        publish_agent_log(
            "bridge.command_applied",
            {
                "event": "command_applied",
                "simulated": True,
                "offset": offset,
                "sender": sender,
                "topic": topic,
                "on": desired_on,
                "toggle_after": toggle_after,
            },
        )
        return "applied"

    else:
        print(f"  └─ [SKIP] unknown topic '{topic}', ignoring")
        publish_agent_log(
            "bridge.command_skipped",
            {
                "event": "command_skipped",
                "simulated": True,
                "offset": offset,
                "sender": sender,
                "topic": topic,
                "reason": "unknown_topic",
            },
        )
        return "skipped"


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def banner(state: dict) -> None:
    print("=" * 60)
    print("  Shelly Plug S Gen3 Simulator")
    print("=" * 60)
    print(f"  Device:   {DEVICE_NAME}")
    print(f"  Incoming: {INCOMING_CHANNEL or '(not set — command polling disabled)'}")
    print(f"  Interval: {POLL_SECONDS}s")
    print(f"  Switch:   {'ON' if state.get('output', True) else 'OFF'}")
    print(f"  Agent logs: {'on' if AGENT_LOG_ENABLED and AGENT_NAME else 'off'}")
    if AGENT_LOG_ENABLED and AGENT_NAME:
        print(f"  Agent:    {AGENT_NAME}")
        print(f"  Cycles:   {'on' if AGENT_LOG_CYCLES else 'off'}")
    print("=" * 60)
    print()


def main() -> None:
    state = load_state()
    banner(state)

    if not INCOMING_CHANNEL:
        print("Warning: INCOMING_CHANNEL not set. Commands will not be polled.")
        print("Set it and restart to enable command handling.\n")

    tick = 0
    while True:
        tick += 1
        ts = time.strftime("%H:%M:%S")
        command_counts = {"applied": 0, "failed": 0, "skipped": 0}

        # Poll for commands every cycle
        if INCOMING_CHANNEL:
            data = read_incoming()
            if data and data.get("messages"):
                last_offset = int(state.get("last_command_offset", -1))
                new_msgs = sorted(
                    [m for m in data["messages"] if m.get("offset", -1) > last_offset],
                    key=lambda m: m.get("offset", -1),
                )
                for msg in new_msgs:
                    outcome = handle_command(msg, state)
                    if outcome in command_counts:
                        command_counts[outcome] += 1
                    state["last_command_offset"] = int(msg.get("offset", -1))
                    save_state(state)

        telemetry = fake_telemetry(state, tick)
        ok = publish_telemetry("telemetry.switch_status", telemetry)
        if ok and AGENT_LOG_CYCLES:
            publish_agent_log(
                "bridge.cycle",
                {
                    "event": "telemetry_published",
                    "simulated": True,
                    "telemetry_ok": True,
                    "topic": "telemetry.switch_status",
                    "command_counts": command_counts,
                    "output": telemetry["output"],
                    "apower_w": telemetry["apower_w"],
                    "voltage_v": telemetry["voltage_v"],
                },
            )
        elif not ok:
            publish_agent_log(
                "bridge.telemetry_failed",
                {
                    "event": "telemetry_publish_failed",
                    "simulated": True,
                    "telemetry_ok": False,
                    "topic": "telemetry.switch_status",
                    "command_counts": command_counts,
                },
            )

        status = (
            f"[{ts}] #{tick:04d} | "
            f"{'ON ' if telemetry['output'] else 'OFF'} | "
            f"{telemetry['apower_w']:7.2f} W | "
            f"{telemetry['voltage_v']:.1f} V | "
            f"{telemetry['current_a']:.3f} A | "
            f"{'ok' if ok else 'FAILED'}"
        )
        print(status)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
