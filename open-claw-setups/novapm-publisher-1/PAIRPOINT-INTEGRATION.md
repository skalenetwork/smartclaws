# Pairpoint signing — integration & migration runbook

Adds message signing to the NovaPM publisher: **sign every message published
on-chain, verify every message read back**, using the customer's Pairpoint tools
(`pp` to sign, `decode_blob.py` to verify).

This file is the runbook for moving the change onto the customer's Raspberry Pi.
It is documentation only — nothing here runs automatically.

---

## Design in one paragraph

The payload is wrapped in a **signed envelope** before publishing:
`{"sig":{"v":1,"scheme":"pairpoint","app_id":"…","blob":"<signature>","body":"<exact signed string>"}}`.
The real data is carried **verbatim** as the string `sig.body`, and verification
checks that exact string. Nothing is re-serialized on the read side, so it does
**not** matter how the deployed `smartclaws` CLI serializes numbers or orders
keys — the signature always checks against the same bytes that were signed. The
data exists only inside the signed string, so there is no unsigned copy to tamper
with. All of this is handled by one helper the skills call; the agent never runs
`pp`/`decode_blob.py` by hand or hand-builds the envelope.

> This is why the integration lives entirely in **skills**, not in the CLI: it
> only uses the CLI's public interface (`publish --data <json>`, `read --json`)
> and is deliberately independent of that build's internals.

---

## What changed in this setup (files to carry over)

New:
- `skills/smartclaws-pairpoint-signing/SKILL.md` — how to sign/verify.
- `skills/smartclaws-pairpoint-signing/pp-sig.py` — the helper (sign & verify).

Edited:
- `AGENTS.md` — Environment Contract gains a **Message signing (Pairpoint)**
  table (`PP_SIG_HELPER`, `PP_BIN`, `PP_DECODE`, `PP_APP_ID`); Red Lines gain the
  single exec-only exception for running the two tools under `~/fromtim`.
- `skills/smartclaws-novapm-publish-telemetry/SKILL.md` — sign before publish.
- `skills/smartclaws-publish-decisions/SKILL.md` — sign the cycle log too.
- `skills/smartclaws-novapm-read/SKILL.md` — verify every message on read.
- `skills/smartclaws-novapm-master/SKILL.md` — composes the signing skill.

---

## Assumptions to confirm on the Pi (I could not test these here)

The real `pp`/`decode_blob.py` aren't on this machine, so these come from the
screenshot and must be checked during the drift review:

1. **Paths.** `PP_BIN = ~/fromtim/Go_PP_Agent/pp`,
   `PP_DECODE = ~/fromtim/blob_decode/decode_blob.py`. If either differs, set the
   env var — do **not** edit the helper.
2. **App id.** `PP_APP_ID = TestApplicationID` (the `naf_id` / `--app-id`).
3. **Sign flags.** Helper calls `pp -s -p "<body>"` and reads `.signature` from
   its JSON. Confirm `-s`/`-p` still mean sign/plaintext and the field is
   `signature`.
4. **Verify flags.** Helper calls
   `python3 decode_blob.py verify --app-id <id> --data <body> --signature-blob <blob>`
   and reads `.valid` (falls back to `.isValid`). Confirm.
5. **Working dirs.** The helper runs `pp` with cwd = its own folder and
   `decode_blob.py` with cwd = its folder, in case they read `config.toml` /
   `secrets/` relatively. If a tool needs a different cwd, tell me.
6. **Message length.** The screenshot signs `"Hello World"`; our `body` is a
   compact JSON string (~120–200 chars). Confirm `pp` signs arbitrary text of
   that length.

---

## Step 1 — Verify drift (here ↔ Pi)

Compare this setup against the workspace on the Pi
(`~/.openclaw/workspace/`). The agent's own home files map like this:

| Here (this repo)                       | On the Pi                                  |
|----------------------------------------|--------------------------------------------|
| `AGENTS.md`, `SOUL.md`, `USER.md`, …   | `~/.openclaw/workspace/`                    |
| `skills/<name>/`                       | `~/.openclaw/workspace/skills/<name>/`      |
| `controller/`                          | `~/.openclaw/workspace/controller/`         |

The deployed skills may have drifted from this folder. Before copying, diff the
files you're about to overwrite (`AGENTS.md`, the four edited skills) so you don't
clobber a Pi-side change. Reconcile any real differences by hand; only then copy.

## Step 2 — Copy the new content over

Copy the new skill folder and the edited files into
`~/.openclaw/workspace/` on the Pi (rsync/scp/git — your call). At minimum:

- `skills/smartclaws-pairpoint-signing/` (the whole folder)
- the four edited skill `SKILL.md` files
- `AGENTS.md`

If `PP_BIN` / `PP_DECODE` / `PP_APP_ID` differ from the defaults, export them in
the agent's environment (e.g. the OpenClaw service env / the shell that launches
it) so the helper picks them up — no code edit.

## Step 3 — Smoke-test, then resume

On the Pi, confirm the round-trip **before** resuming the cron cycle:

```bash
printf '%s' '{"pm25_ug_m3":12.3,"pm10_ug_m3":28.1,"sensor":"sds011","port":"/dev/ttyUSB0","ts":"2026-06-17T10:00:00Z"}' \
  | python3 ~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py sign \
  | python3 ~/.openclaw/workspace/skills/smartclaws-pairpoint-signing/pp-sig.py verify
```

Expect `{"ok": true, "valid": true, …, "body": {…}}`. If instead you get
`{"ok": false, "error": "…"}`, the message names the problem (usually a tool path
— fix via the `PP_*` env vars) — fix that first. Once the smoke test passes,
resume the normal cycle; publishes will be signed and reads verified from the
next cron run onward.
