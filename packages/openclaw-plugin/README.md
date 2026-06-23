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
| `smartclaws_wallet_info` | read | Wallet address + on-chain balance (never the private key). |
| `smartclaws_read` | read | Decoded messages from a device's outgoing channel or a direct channel. No wallet required. |
| `smartclaws_publish` | write (`optional`) | Publish an envelope to a channel; returns the transaction hash and status. |

## Configuration

Plugin config (in the OpenClaw Gateway config entry):

```jsonc
{
  "smartclawsHome": "~/.smartclaws", // optional; defaults to SMARTCLAWS_HOME or ~/.smartclaws
  "network": "base-testnet",         // optional default network
  "rpcUrl": "https://...",           // optional RPC override
  "registryAddress": "0x..."         // optional registry override
}
```

The wallet and config files are managed by the SmartClaws CLI (`smartclaws init`).
Private keys stay in the wallet file and are never returned by any tool.

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
Topic: telemetry.pm
Payload: { "pm25": number, "pm10": number, "unit": "ug_m3" }
```
