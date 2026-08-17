# smartclaws-openclaw-plugin

An [OpenClaw tool plugin](https://docs.openclaw.ai/plugins/tool-plugins) that exposes
SmartClaws operations — publishing and reading IoT telemetry on SKALE — as
agent-callable tools.

It is a thin binding over [`@smartclaws/sdk`](../sdk); the SDK and `@smartclaws/core`
(plus `viem`) are bundled into `dist/index.js` at build time, so the published
package only needs `typebox` at runtime and `openclaw` as a peer.

## Tools

| Tool | Mode | Description |
| --- | --- | --- |
| `smartclaws_wallet_info` | read | Wallet address, balance, and whether the registered public key is the one this wallet can decrypt with (never the private key). O(1) — no per-entity work. |
| `smartclaws_access_check` | read | Whether this wallet can read a device or agent's incoming and outgoing channels. Plain channels are readable by anyone; encrypted ones depend on the reader list. Names one entity, or omits both to cover all known ones. |
| `smartclaws_read` | read | Free ciphertext-or-decoded messages from any device/agent channel (`side`: `outgoing` default, or `incoming`) or a direct channel. No wallet required. Encrypted ciphertext is a successful read, not a decode error. |
| `smartclaws_disclose` | write (`optional`) | Paid two-phase disclosure: signs, waits for CTX, decrypts. Same `side` targeting as read. Batch 1–10. Checks reader authorization and public-key registration before spending. |
| `smartclaws_publish` | write (`optional`) | Publish device telemetry, agent outbound logs, or direct channel envelopes. Auto-detects encryption, waits for CTX by default, and returns `PublishState` — `scheduled` is not published. |
| `smartclaws_notify` | write (`optional`) | Publish to another agent's incoming channel. Same `PublishState` contract as publish. Requires `SENDER_ROLE` on that agent. |

There is no separate BITE RPC setting. Every SKALE node serves the `bite_*` methods
on the configured `rpcUrl`.

## Configuration

Plugin config (in the OpenClaw Gateway config entry):

```jsonc
{
  "smartclawsHome": "~/.smartclaws", // optional; defaults to SMARTCLAWS_HOME or ~/.smartclaws
  "network": "base-testnet",         // optional default network
  "rpcUrl": "https://...",           // optional RPC override (also used for bite_* calls)
  "registryAddress": "0x..."         // optional registry override
}
```

The wallet and config files are managed by the SmartClaws CLI (`smartclaws init`).
Private keys stay in the wallet file and are never returned by any tool.

### Viewing keys

Paid disclosure decrypts with a **viewing key**, which is the wallet's signing key unless a
separate one is configured (`smartclaws key generate`). The registry stores whatever public key
an account registers and does not prove ownership, so the two can disagree — and nothing on the
paid path detects it: the request uses whatever is registered, and the ECIES in use has no MAC,
so a wrong key looks like corrupt data rather than a wrong key. The fee is spent either way.

The fix is simply to register the right key and ask again. `smartclaws_wallet_info` reports it
as `registeredKeyOpensDisclosures`, so check that before disclosing rather than after paying.

## Install

Published package:

```bash
openclaw plugins install clawhub:smartclaws-openclaw-plugin
openclaw plugins inspect smartclaws --runtime
```

Local checkout:

```bash
openclaw plugins install ./packages/openclaw-plugin
openclaw plugins inspect smartclaws --runtime
```

Restart or reload the OpenClaw Gateway after installing or updating the plugin.

## Build & validate

```bash
# from the repo root, build dependencies first
cd packages/core && bun run build
cd ../sdk && bun run build

# build the bundled plugin entry
cd ../openclaw-plugin && bun run build

# generate openclaw.plugin.json, then validate against the installed OpenClaw
bun run manifest
bun run validate
```

`bun run manifest:check` fails if `openclaw.plugin.json` is stale (use in CI).

## Skill snippet

Device skills become thin domain instructions:

```text
Requires the SmartClaws plugin.
Publish PM telemetry with smartclaws_publish.
Treat status=scheduled as not stored; only status=published means the message landed.
Read ciphertext with smartclaws_read (free). Disclose with smartclaws_disclose (paid, optional).
Topic: telemetry.pm
Payload: { "pm25": number, "pm10": number, "unit": "ug_m3" }
```
