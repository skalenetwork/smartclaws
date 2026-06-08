#!/usr/bin/env python3
"""
Shelly Plug S Gen3 REAL Bridge — SmartClaws

The real-hardware counterpart to dev/shelly-sim.py. Talks to an actual Shelly
Plug S Gen3 over HTTP RPC on the local network:

  1. Reads real telemetry (/rpc/Switch.GetStatus) and publishes it as
     telemetry.switch_status to the device outgoing channel.
  2. Polls the device incoming channel for command.switch.set envelopes and
     applies them to the real relay via /rpc/Switch.Set.

Required env vars:
  SMARTCLAWS_HOME     publisher/controller config dir (e.g. ~/.sc-controller)
  DEVICE_NAME         smartclaws device name (e.g. shelly-plug-s)
  SHELLY_HOST         Shelly IP or hostname (e.g. 192.168.1.125)
  INCOMING_CHANNEL    device incoming channel address (0x...)

Optional env vars:
  POLL_SECONDS        publish/poll interval in seconds (default: 10)
  SMARTCLAWS_BIN      path to smartclaws binary (default: smartclaws)
  STATE_FILE          last-command offset state (default: $SMARTCLAWS_HOME/shelly-bridge.state.json)
  SHELLY_USER         digest-auth user (only if the plug has auth enabled)
  SHELLY_PASSWORD     digest-auth password
  HTTP_TIMEOUT        per-request timeout seconds (default: 5)
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

try:
    # Only needed if the plug has auth enabled.
    import requests  # type: ignore
    from requests.auth import HTTPDigestAuth  # type: ignore
    _HAVE_REQUESTS = True
except Exception:
    _HAVE_REQUESTS = False

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SC_HOME = os.environ.get("SMARTCLAWS_HOME", os.path.expanduser("~/.sc-controller"))
DEVICE_NAME = os.environ.get("DEVICE_NAME", "shelly-plug-s")
SHELLY_HOST = os.environ.get("SHELLY_HOST", "")
INCOMING_CHANNEL = os.environ.get("INCOMING_CHANNEL", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "120"))
SMARTCLAWS = os.environ.get("SMARTCLAWS_BIN", "smartclaws")
STATE_FILE = os.environ.get(
    "STATE_FILE", os.path.join(SC_HOME, "shelly-bridge.state.json")
)
SHELLY_USER = os.environ.get("SHELLY_USER", "")
SHELLY_PASSWORD = os.environ.get("SHELLY_PASSWORD", "")
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "5"))

if not SHELLY_HOST:
    print("FATAL: SHELLY_HOST not set.", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"last_command_offset": -1}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


# ---------------------------------------------------------------------------
# Shelly HTTP RPC
# ---------------------------------------------------------------------------

def shelly_rpc(method: str, params: dict | None = None) -> dict:
    """GET http://<host>/rpc/<method>?<params>. Uses digest auth if creds set."""
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"http://{SHELLY_HOST}/rpc/{method}{qs}"
    if SHELLY_USER and SHELLY_PASSWORD:
        if not _HAVE_REQUESTS:
            raise RuntimeError("SHELLY_USER/PASSWORD set but 'requests' not installed")
        r = requests.get(
            url, auth=HTTPDigestAuth(SHELLY_USER, SHELLY_PASSWORD), timeout=HTTP_TIMEOUT
        )
        r.raise_for_status()
        return r.json()
    with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read())


def read_switch_status() -> dict:
    """Map Shelly Switch.GetStatus -> SmartClaws telemetry.switch_status payload."""
    s = shelly_rpc("Switch.GetStatus", {"id": 0})
    aenergy = s.get("aenergy", {}) or {}
    temp = s.get("temperature", {}) or {}
    return {
        "output": bool(s.get("output", False)),
        "apower_w": round(float(s.get("apower", 0.0)), 2),
        "voltage_v": round(float(s.get("voltage", 0.0)), 2),
        "current_a": round(float(s.get("current", 0.0)), 3),
        "energy_total": round(float(aenergy.get("total", 0.0)), 3),
        "temperature_c": round(float(temp.get("tC", 0.0)), 1),
    }


def set_switch(on: bool, toggle_after: int | None = None) -> dict:
    params = {"id": 0, "on": "true" if on else "false"}
    if toggle_after:
        params["toggle_after"] = int(toggle_after)
    return shelly_rpc("Switch.Set", params)


# ---------------------------------------------------------------------------
# SmartClaws I/O
# ---------------------------------------------------------------------------

def publish_telemetry(topic: str, payload: dict) -> bool:
    env = {**os.environ, "SMARTCLAWS_HOME": SC_HOME}
    result = subprocess.run(
        [SMARTCLAWS, "publish", "--device", DEVICE_NAME, "--topic", topic,
         "--data", json.dumps(payload)],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  [ERR] publish failed: {result.stderr.strip()[:200]}", file=sys.stderr)
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
    if result.returncode != 0 or not result.stdout.strip().startswith("{"):
        return None
    try:
        return json.loads(result.stdout)
    except Exception:
        return None


def handle_command(envelope: dict, state: dict) -> dict:
    topic = envelope.get("topic", "")
    payload = envelope.get("p", {})
    sender = envelope.get("dev", "unknown")
    offset = envelope.get("offset", "?")

    print(f"  ┌─ COMMAND [offset {offset}] from '{sender}': {topic} {json.dumps(payload)}")
    if topic != "command.switch.set":
        print(f"  └─ [SKIP] unknown topic")
        return state

    desired_on = payload.get("on")
    if not isinstance(desired_on, bool):
        print(f"  └─ [SKIP] invalid 'on': {desired_on!r}")
        return state

    try:
        set_switch(desired_on, payload.get("toggle_after"))
        print(f"  └─ [REAL] relay set {'ON 🟢' if desired_on else 'OFF 🔴'} on {SHELLY_HOST}")
    except Exception as e:
        print(f"  └─ [ERR] Switch.Set failed: {e}", file=sys.stderr)
    return state


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    state = load_state()
    print("=" * 60)
    print("  Shelly Plug S Gen3 REAL Bridge")
    print(f"  Host:     {SHELLY_HOST}")
    print(f"  Device:   {DEVICE_NAME}")
    print(f"  Incoming: {INCOMING_CHANNEL or '(command polling disabled)'}")
    print(f"  Interval: {POLL_SECONDS}s")
    print("=" * 60)

    tick = 0
    while True:
        tick += 1
        ts = time.strftime("%H:%M:%S")

        if INCOMING_CHANNEL:
            data = read_incoming()
            if data and data.get("messages"):
                last = int(state.get("last_command_offset", -1))
                new = sorted([m for m in data["messages"] if m.get("offset", -1) > last],
                             key=lambda m: m.get("offset", -1))
                for msg in new:
                    state = handle_command(msg, state)
                    state["last_command_offset"] = int(msg.get("offset", -1))
                    save_state(state)

        try:
            telem = read_switch_status()
            ok = publish_telemetry("telemetry.switch_status", telem)
            print(f"[{ts}] #{tick:04d} | {'ON ' if telem['output'] else 'OFF'} | "
                  f"{telem['apower_w']:7.2f} W | {telem['voltage_v']:.1f} V | "
                  f"{'ok' if ok else 'PUBLISH-FAILED'}")
        except Exception as e:
            print(f"[{ts}] #{tick:04d} | [ERR] read telemetry: {e}", file=sys.stderr)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
