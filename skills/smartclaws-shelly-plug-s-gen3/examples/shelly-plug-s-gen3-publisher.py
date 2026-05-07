#!/usr/bin/env python3
"""Publish Shelly Plug S Gen3 telemetry to SmartClaws and apply commands."""

import json
import os
import subprocess
import sys
import time
from typing import Any, Dict, Optional

import requests
from requests.auth import HTTPDigestAuth


SHELLY_HOST = os.environ.get("SHELLY_HOST", "")
SHELLY_USER = os.environ.get("SHELLY_USER", "")
SHELLY_PASS = os.environ.get("SHELLY_PASS", "")
DEVICE_NAME = os.environ.get("DEVICE_NAME", "shelly-plug-s")
INCOMING_CHANNEL = os.environ.get("INCOMING_CHANNEL", "")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "10"))
STATE_FILE = os.environ.get(
    "STATE_FILE", os.path.expanduser("~/.smartclaws/scripts/shelly-plug-s-gen3.state.json")
)
SMARTCLAWS_BIN = os.environ.get("SMARTCLAWS_BIN", "smartclaws")


def fail(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


def auth_obj() -> Optional[HTTPDigestAuth]:
    if SHELLY_USER and SHELLY_PASS:
        return HTTPDigestAuth(SHELLY_USER, SHELLY_PASS)
    return None


def shelly_get(path: str, timeout: int = 8) -> Dict[str, Any]:
    url = f"http://{SHELLY_HOST}{path}"
    resp = requests.get(url, timeout=timeout, auth=auth_obj())
    resp.raise_for_status()
    return resp.json()


def shelly_set_switch(on: bool, toggle_after: Optional[int]) -> None:
    url = f"/rpc/Switch.Set?id=0&on={'true' if on else 'false'}"
    if toggle_after is not None:
        url += f"&toggle_after={int(toggle_after)}"
    shelly_get(url)


def load_state() -> Dict[str, Any]:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {"last_command_offset": -1}
    except Exception:
        return {"last_command_offset": -1}


def save_state(state: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump(state, fh)


def smartclaws_publish(topic: str, payload: Dict[str, Any]) -> bool:
    cmd = [
        SMARTCLAWS_BIN,
        "publish",
        "--device",
        DEVICE_NAME,
        "--topic",
        topic,
        "--data",
        json.dumps(payload),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"publish error: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def read_commands(limit: int = 20) -> Dict[str, Any]:
    cmd = [
        SMARTCLAWS_BIN,
        "read",
        "--channel",
        INCOMING_CHANNEL,
        "--limit",
        str(limit),
        "--json",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "failed to read command channel")
    return json.loads(result.stdout)


def parse_status_payload(status: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "output": status.get("output"),
        "apower_w": status.get("apower"),
        "voltage_v": status.get("voltage"),
        "current_a": status.get("current"),
    }
    aenergy = status.get("aenergy") or {}
    temp = status.get("temperature") or {}
    payload["energy_total"] = aenergy.get("total")
    payload["temperature_c"] = temp.get("tC")
    return payload


def handle_command_envelope(envelope: Dict[str, Any]) -> None:
    topic = envelope.get("topic")
    if topic != "command.switch.set":
        return
    payload = envelope.get("p") or {}
    if not isinstance(payload.get("on"), bool):
        print("skip command: missing boolean field 'on'", file=sys.stderr)
        return
    toggle_after = payload.get("toggle_after")
    if toggle_after is not None:
        try:
            toggle_after = int(toggle_after)
        except Exception:
            print("skip command: invalid toggle_after", file=sys.stderr)
            return
    shelly_set_switch(payload["on"], toggle_after)
    print(f"applied command.switch.set on={payload['on']} toggle_after={toggle_after}")


def validate_env() -> None:
    if not SHELLY_HOST:
        fail("SHELLY_HOST is required")
    if not INCOMING_CHANNEL:
        fail("INCOMING_CHANNEL is required")


def main() -> None:
    validate_env()
    state = load_state()
    print(
        f"Starting Shelly publisher: host={SHELLY_HOST} device={DEVICE_NAME} "
        f"poll={POLL_SECONDS}s"
    )

    while True:
        try:
            status = shelly_get("/rpc/Switch.GetStatus?id=0")
            telemetry = parse_status_payload(status)
            smartclaws_publish("telemetry.switch_status", telemetry)

            command_data = read_commands(limit=20)
            last_offset = int(state.get("last_command_offset", -1))
            for msg in sorted(command_data.get("messages", []), key=lambda m: m.get("offset", -1)):
                offset = int(msg.get("offset", -1))
                if offset <= last_offset:
                    continue
                handle_command_envelope(msg)
                state["last_command_offset"] = offset
                save_state(state)

            print(
                f"telemetry published: output={telemetry.get('output')} "
                f"power={telemetry.get('apower_w')}W"
            )
        except requests.HTTPError as exc:
            print(f"shelly http error: {exc}", file=sys.stderr)
        except Exception as exc:
            print(f"loop error: {exc}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
