#!/usr/bin/env python3
"""
pp-sig.py — Pairpoint sign/verify helper for the NovaPM publisher.

Wraps the customer's Pairpoint tooling so the agent can:
  sign   : turn a telemetry / cycle-log payload into a signed envelope
  verify : check a signed envelope that was read back off-chain

DESIGN NOTE (why this is robust — read before changing):
The signed message is carried VERBATIM inside the envelope as the string
`sig.body`. Verification checks that exact string against the signature blob.
Nothing is re-serialized on the read side, so this is immune to how any given
`smartclaws` CLI build happens to serialize numbers or order keys (the deployed
build has drifted from source — do NOT assume byte-stable round-tripping of
objects). The real payload lives ONLY inside `sig.body` — a single signed source
of truth, with no unsigned mirror that could be tampered with.

Envelope published on-chain (this whole object is the `--data` for
`smartclaws publish`):

  {
    "sig": {
      "v": 1,
      "scheme": "pairpoint",
      "app_id": "TestApplicationID",
      "blob": "<pp signature hex>",
      "body": "<exact JSON string that was signed>"
    }
  }

Config via env (so paths/app-id can be corrected on the Pi WITHOUT editing code):
  PP_BIN     default ~/fromtim/Go_PP_Agent/pp            (signer)
  PP_DECODE  default ~/fromtim/blob_decode/decode_blob.py (verifier)
  PP_APP_ID  default TestApplicationID

Usage (payload / envelope arrives on STDIN):
  echo '{"pm25_ug_m3":12.3,...}' | pp-sig.py sign      -> prints signed envelope
  echo '{"sig":{...}}'           | pp-sig.py verify    -> prints {"valid":true,...}

Exit codes: 0 = ok/valid, 2 = signature invalid or unsigned, 1 = error.
"""
import os
import sys
import json
import subprocess

HOME = os.path.expanduser("~")
PP_BIN = os.environ.get("PP_BIN", os.path.join(HOME, "fromtim/Go_PP_Agent/pp"))
PP_DECODE = os.environ.get("PP_DECODE", os.path.join(HOME, "fromtim/blob_decode/decode_blob.py"))
PP_APP_ID = os.environ.get("PP_APP_ID", "TestApplicationID")


def die(msg, code=1):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(code)


def extract_json(text):
    """Parse a JSON object, tolerating log noise printed around it."""
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    i, j = text.find("{"), text.rfind("}")
    if i != -1 and j != -1 and j > i:
        return json.loads(text[i:j + 1])
    raise ValueError("no JSON object found in tool output")


def canonical(obj):
    """Deterministic, compact serialization. Transported verbatim, so the only
    thing that matters is that sign and (the same) string get carried forward."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def run(cmd, cwd):
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60)
    except FileNotFoundError as e:
        die(f"pairpoint tool not found: {e}")
    except subprocess.TimeoutExpired:
        die("pairpoint tool timed out")


def do_sign():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except Exception as e:
        die(f"stdin is not valid JSON: {e}")
    if not isinstance(payload, dict):
        die("payload must be a JSON object")
    body = canonical(payload)

    if not os.path.exists(PP_BIN):
        die(f"PP_BIN not found at {PP_BIN} (set $PP_BIN)")
    p = run([PP_BIN, "-s", "-p", body], cwd=os.path.dirname(PP_BIN) or ".")
    if p.returncode != 0:
        die(f"pp sign failed (exit {p.returncode}): {(p.stderr or p.stdout).strip()}")
    try:
        out = extract_json(p.stdout)
    except Exception as e:
        die(f"could not parse pp output: {e}")

    blob = out.get("signature")
    if not blob:
        die("pp output had no 'signature' field")

    # Emit ONLY the signature blob + signed body. Never surface pp's key
    # material / imsi / session_id / auth_tag — those are not ours to publish.
    envelope = {
        "sig": {
            "v": 1,
            "scheme": "pairpoint",
            "app_id": PP_APP_ID,
            "blob": blob,
            "body": body,
        }
    }
    print(json.dumps(envelope))


def do_verify():
    raw = sys.stdin.read()
    try:
        env = json.loads(raw)
    except Exception as e:
        die(f"stdin is not valid JSON: {e}")

    sig = env.get("sig") if isinstance(env, dict) else None
    if not isinstance(sig, dict):
        # Legacy / unsigned message — report plainly, don't crash.
        print(json.dumps({"ok": True, "valid": False, "reason": "no sig envelope (unsigned/legacy message)"}))
        sys.exit(2)

    app_id = sig.get("app_id") or PP_APP_ID
    blob = sig.get("blob")
    body = sig.get("body")
    if not blob or body is None:
        die("sig envelope missing 'blob' or 'body'")

    if not os.path.exists(PP_DECODE):
        die(f"PP_DECODE not found at {PP_DECODE} (set $PP_DECODE)")
    p = run(
        ["python3", PP_DECODE, "verify", "--app-id", app_id, "--data", body, "--signature-blob", blob],
        cwd=os.path.dirname(PP_DECODE) or ".",
    )
    if p.returncode != 0:
        die(f"decode_blob verify failed (exit {p.returncode}): {(p.stderr or p.stdout).strip()}")
    try:
        res = extract_json(p.stdout)
    except Exception as e:
        die(f"could not parse decode_blob output: {e}")

    valid = bool(res.get("valid", res.get("isValid", False)))
    try:
        data = json.loads(body)  # hand the caller the actual payload, already parsed
    except Exception:
        data = None

    print(json.dumps({
        "ok": True,
        "valid": valid,
        "app_id": app_id,
        "expirationTimestamp": res.get("expirationTimestamp"),
        "body": data,
    }))
    sys.exit(0 if valid else 2)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("sign", "verify"):
        die("usage: pp-sig.py {sign|verify}   (payload/envelope on stdin)")
    do_sign() if sys.argv[1] == "sign" else do_verify()


if __name__ == "__main__":
    main()
