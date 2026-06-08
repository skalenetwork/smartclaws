---
name: smartclaws-shelly-write
description: >
  Publish a relay ON or OFF command on-chain to the Shelly Plug S. Use this
  to switch the plug — whether from the automated control cycle or a direct
  user request. Signs a transaction with the wallet and changes physical device
  state.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "⚡"
    homepage: https://github.com/skalenetwork/smartclaws
---

# {{DEVICE_LABEL}} — Write Command

Publish a command to the Shelly's **incoming** channel to switch the relay. The
plug picks it up and acts on it. This is a **mutating** action: it signs an
on-chain transaction with the wallet and changes real device state.

Paths and the channel address are the fixed constants in `AGENTS.md`. Use those
values — do not invent addresses.

---

## Publish

Write to `SHELLY_INCOMING_CHANNEL`. Use `--from controller`.

```bash
SMARTCLAWS_HOME={{WORKSPACE_ROOT}}/controller \
  {{WORKSPACE_ROOT}}/bin/smartclaws publish \
  --channel {{SHELLY_INCOMING_CHANNEL}} \
  --from controller \
  --topic command.switch.set \
  --data '{"on": true, "toggle_after": 0}'
```

- Set `"on": true` to turn the relay **ON**, `"on": false` to turn it **OFF**.
- `"toggle_after": 0` means the command takes effect immediately and does not
  auto-revert. (A non-zero value would toggle back after that many seconds —
  leave it 0 unless explicitly asked.)

### Command payload — `command.switch.set`

```json
{ "on": true, "toggle_after": 0 }
```

| Field | Meaning |
|---|---|
| `on` | Desired relay state — `true` = ON, `false` = OFF |
| `toggle_after` | Seconds before auto-reverting; `0` = stay as set |

---

## Successful publish output

```
Published controller/command.switch.set to channel 0x...
  Tx:     0xabc123...
  Status: success
```

Capture the `Tx:` line — report the transaction hash back with the prefix
`https://base-sepolia-testnet-explorer.skalenodes.com/tx/` so the action is
auditable. If publish fails, **fail loud**: say it failed and surface the error;
do not claim the plug was switched.

---

## After publishing

- The command is **queued on-chain**, not an instant confirmation of the
  physical relay. To verify the plug actually switched, use
  `smartclaws-shelly-read` and check `output` on the next telemetry message.
- Don't re-send the same command repeatedly. One command per intent; confirm via
  telemetry rather than spamming. Propagation can take a few minutes — always
  account for that before retrying.
- Ask for confirmation before re-submitting a repeated command.
