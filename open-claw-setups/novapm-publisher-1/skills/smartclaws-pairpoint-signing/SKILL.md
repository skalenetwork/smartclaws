---
name: smartclaws-pairpoint-signing
description: >
  Sign an outgoing payload and verify an incoming one using the customer's
  Pairpoint tooling (pp + decode_blob.py). Every message this agent publishes
  on-chain is wrapped in a signed envelope; every message it reads back is
  checked against its signature. Use whenever you are about to publish, or have
  just read, any on-chain data for this deployment.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🔏"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws NovaPM — Pairpoint Message Signing

This deployment partners with **Pairpoint** for message authenticity. The rule
is simple and applies to **every** on-chain message:

- **Publishing:** sign the payload first, publish the *signed envelope*.
- **Reading:** verify each message's signature before you trust or report it.

You never call `pp` or `decode_blob.py` by hand and you never hand-build the
envelope JSON. A helper script does both — it handles JSON quoting, the tools'
working directories, extracting the signature, and the envelope format. Your job
is to pipe payloads through it.

---

## Why a signed *envelope* (and not just a signature field)

The signed message is carried **verbatim** inside the envelope as the string
`sig.body`. Verification checks that exact string — nothing is re-serialized on
the read side. This matters because the deployed `smartclaws` CLI is **not
guaranteed to round-trip a JSON object byte-for-byte** (numbers like `12.0` may
come back as `12`, key order may change). If we signed the object and re-built
it on read, verification would fail intermittently. By signing a string and
transporting that exact string, verification is stable regardless of CLI build.

The real payload lives **only** inside `sig.body` — there is no unsigned copy to
tamper with.

### Envelope shape (this whole object becomes `--data` for `publish`)

```json
{
  "sig": {
    "v": 1,
    "scheme": "pairpoint",
    "app_id": "TestApplicationID",
    "blob": "8700000000000002e8b6eaeee7eaeeb0c930d284f984ceaaa260703195d3cc72130d",
    "body": "{\"pm25_ug_m3\":12.3,\"pm10_ug_m3\":28.1,\"port\":\"/dev/ttyUSB0\",\"sensor\":\"sds011\",\"ts\":\"2026-06-17T10:00:00Z\"}"
  }
}
```

`sig.body` is the exact string the signer signed and the verifier checks. To use
the data, `JSON.parse` / `json.loads` that string.

---

## The helper

Path (fixed constant, see `AGENTS.md` → Environment Contract):

```
~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py
```

It reads the payload/envelope on **stdin** and writes JSON to **stdout**.
Tool locations come from env (defaults in `AGENTS.md`): `PP_BIN`, `PP_DECODE`,
`PP_APP_ID`. To point at different paths on this host, export those vars — never
edit the script.

### Sign a payload

Pipe the *plain* payload in; capture the signed envelope out:

```bash
SIGNED=$(printf '%s' '{"pm25_ug_m3":12.3,"pm10_ug_m3":28.1,"sensor":"sds011","port":"/dev/ttyUSB0","ts":"2026-06-17T10:00:00Z"}' \
  | python3 ~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py sign)
```

Then publish `$SIGNED` as the payload (quote it — it contains escaped quotes):

```bash
SMARTCLAWS_HOME=~/.openclaw/workspace/controller \
  ~/.openclaw/workspace/bin/smartclaws publish \
  --channel <CHANNEL> --from <IDENTITY> --topic <TOPIC> \
  --data "$SIGNED"
```

If the sign step exits non-zero it prints `{"ok":false,"error":"..."}`. **Do not
publish** — fail loud with that error (e.g. `pp` missing, sensor tool path wrong).

### Verify a message

Feed one message's payload object (its `p` field from `read --json`, which is the
`{"sig":{...}}` envelope) into the helper:

```bash
printf '%s' '<the message .p object>' \
  | python3 ~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py verify
```

Output:

```json
{ "ok": true, "valid": true, "app_id": "TestApplicationID",
  "expirationTimestamp": "2029-07-09T11:02:33Z",
  "body": { "pm25_ug_m3": 12.3, "pm10_ug_m3": 28.1, "sensor": "sds011", "port": "/dev/ttyUSB0", "ts": "2026-06-17T10:00:00Z" } }
```

- `valid: true` → authentic. Use `body` (already parsed) as the data.
- `valid: false` with `reason: "no sig envelope..."` → an **unsigned/legacy**
  message (published before this integration). Report the data if you show it,
  but label it **UNVERIFIED** — never present it as signed.
- `valid: false` otherwise → the signature did **not** check out. Treat the data
  as untrusted; say so plainly. Do not silently drop it.
- `ok: false` → the verifier itself failed (tool missing, etc.). Fail loud.

---

## The underlying Pairpoint commands (for humans / debugging)

The helper runs these for you — shown so you can reason about failures. Do not
run them by hand in normal operation.

**Sign** (from `~/fromtim/Go_PP_Agent`): `./pp -s -p "<message>"` → prints JSON;
the `signature` field is the blob. (The rest of pp's output — `key.material`,
`imsi`, `session_id`, `auth_tag` — is **not** ours to publish or log; the helper
drops it.)

**Verify** (from `~/fromtim/blob_decode`):
`python3 decode_blob.py verify --app-id "TestApplicationID" --data "<message>" --signature-blob "<blob>"`
→ prints `{"isValid":true,"valid":true,...}`.

---

## Rules

- **Sign every publish, verify every read.** No exceptions for telemetry vs. logs.
- **Never fabricate a signature or an envelope.** If signing fails, don't publish.
- **Never publish pp's key material.** Only `blob` + `body` leave this helper.
- **Exec only, outside the workspace.** `pp` and `decode_blob.py` live under
  `~/fromtim` — the env contract permits *executing* them. You still never read,
  list, or traverse their folders, `secrets/`, `config.toml`, or logs.
- **Fail loud.** A visible signing/verification failure beats a silent one.
