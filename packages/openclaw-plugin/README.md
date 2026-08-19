# smartclaws-openclaw-plugin

An [OpenClaw tool plugin](https://docs.openclaw.ai/plugins/tool-plugins) that exposes
SmartClaws operations — setup, identity, publication, disclosure, authority, keys,
and recovery — as individually gated agent tools.

It is a thin binding over [`@smartclaws/sdk`](../sdk). The SDK and `@smartclaws/core`
(plus `viem`) are bundled into `dist/index.js` at build time, so the published
package only needs `typebox` at runtime and `openclaw` as a peer.

Skills under `skills/` are intentionally stale until this tool surface is released.
Do not treat current skill text as the tool contract.

## Guided setup (no CLI required)

A generated-wallet deployment can be completed without the SmartClaws CLI:

1. Call `smartclaws_setup_status`. It works even when no HOME exists and reports
   the current state plus recommended next tools.
2. Call `smartclaws_initialize` with a named network (`base-testnet`) and mode.
   This generates a signing wallet locally and never returns the private key.
3. Fund the printed wallet address with sFUEL/CREDITS.
4. Register and attach group/device/agent identity as permitted.
5. Re-check `smartclaws_setup_status` until `state` is `ready` (or `degraded-rpc`
   if the chain is temporarily unreachable).

Private-key import is **not** a model-visible tool. OpenClaw tool plugins in this
host have no secret-reference API that would keep a raw key out of transcripts.
Import remains operator-mediated via the CLI. Fresh installs stay CLI-free because
the plugin generates a wallet locally.

## Tools

Read-only diagnostic tools are non-optional. Anything that signs, spends, mutates
HOME configuration, changes authority, modifies keys, or changes backups is
`optional: true` and must be allowlisted.

Existing names are stable: `smartclaws_wallet_info`, `smartclaws_access_check`,
`smartclaws_read`, `smartclaws_disclose`, `smartclaws_publish`, `smartclaws_notify`.

| Tool | Mode | Description |
| --- | --- | --- |
| `smartclaws_setup_status` | read | HOME/setup state machine, fingerprint, issues, and next tools. Never fails solely because RPC is down. |
| `smartclaws_wallet_info` | read | Address, balance, network/chain, and whether the registered public key opens disclosures. O(1). Never the private key. |
| `smartclaws_list_local` | read | Cached groups, devices, and agents. No filesystem paths. |
| `smartclaws_discover` | read | Paginated on-chain discovery. `owned` is agent-only. |
| `smartclaws_access_check` | read | Paginated per-channel read access. Targeted lookup stays cheap. |
| `smartclaws_read` | read | Free ciphertext-or-decoded messages. Encrypted ciphertext is success, not a decode error. Wallet-free. |
| `smartclaws_reader_list` | read | Reader ACL addresses and channel metadata. Not AccessControl roles. |
| `smartclaws_backup_list` | read | Backup names, timestamps, sizes, fingerprints. No paths. |
| `smartclaws_initialize` | write (`optional`) | Configure a fresh or wallet-only HOME; generate a wallet only when missing. Named networks only. |
| `smartclaws_configure` | write (`optional`) | Patch HOME config. Custom RPC is privileged. Refuses deployment changes while attachments exist. |
| `smartclaws_attach` | write (`optional`) | Update local attachments without creating contracts. Recovers a confirmed registration whose local save failed. |
| `smartclaws_sync` | write (`optional`) | Bounded cache refresh. Returns counts, not records. |
| `smartclaws_home_reset` | write (`optional`) | Safety-backup, preserve wallet/view key, clear deployment-bound state. |
| `smartclaws_register_group` | write (`optional`) | Named group registration. Mode-incomplete attachment returns `attachmentIssue`; do not retry after `LOCAL_STATE_SAVE_FAILED`. |
| `smartclaws_register_device` | write (`optional`) | Device registration. Capacity is a decimal string; mode-incomplete attachment is recoverable. |
| `smartclaws_register_agent` | write (`optional`) | Agent registration. Capacity is a decimal string; mode-incomplete attachment is recoverable. |
| `smartclaws_role_grant` / `smartclaws_role_revoke` | write (`optional`) | AccessControl roles. Invalid cross-kind roles are rejected before RPC. |
| `smartclaws_reader_grant` / `smartclaws_reader_revoke` | write (`optional`) | Encrypted-channel reader ACLs. Self-revocation requires `allowSelfRevocation`. |
| `smartclaws_view_key_generate` | write (`optional`) | Create a local viewing key when none exists. |
| `smartclaws_view_key_rotate` | write (`optional`) | Replace it after a backup. Abandons in-flight disclosures. |
| `smartclaws_view_key_register` | write (`optional`) | Register the active viewing public key and verify the postcondition. |
| `smartclaws_view_key_forget` | write (`optional`) | Drop the local viewing key. Disclose/register fail until generate. |
| `smartclaws_view_key_remove` | write (`optional`) | Remove the on-chain public key; local material unchanged. |
| `smartclaws_disclose` | write (`optional`) | Open encrypted messages. Batch 1–10. Timeout is not success; do not retry the same offsets as a new write. |
| `smartclaws_publish` | write (`optional`) | Device telemetry, agent outbound, or explicit channel. `scheduled` is never `published`. |
| `smartclaws_notify` | write (`optional`) | Agent inbound (`publishInbound`). Requires `SENDER_ROLE`. |
| `smartclaws_backup_create` | write (`optional`) | Local snapshot. Contains the signing key. Returns a name, not a path. |
| `smartclaws_backup_clean` | write (`optional`) | Preview then execute against a candidate-set fingerprint. |
| `smartclaws_backup_restore` | write (`optional`) | Restore a named backup after a safety snapshot. |

There is no generic CLI/exec tool. The plugin cannot change OpenClaw `tools.allow`,
`tools.deny`, profiles, or its own plugin config entry. Agent tools never accept a
`home` path argument.

Publication uses `status` (`published`, `scheduled`, `origin-reverted`, `ctx-reverted`).
Do not treat `scheduled` as stored. Confirmed writes use `status: "confirmed"` plus
`txHash`. Never retry a transaction after origin submission; a timeout is pending,
not permission to resubmit.

## Permission recipes

These are documentation only. Encode them in OpenClaw tool policy, not in Skills yet.

- **Observer:** setup_status, wallet_info, list_local, discover, access_check, read, reader_list, backup_list
- **Operator:** Observer + publish, notify, disclose, sync
- **Registrar:** Operator + initialize, configure, attach, register_group, register_device, register_agent
- **Authority administrator:** role_grant, role_revoke, reader_grant, reader_revoke
- **Key administrator:** view_key_generate, view_key_rotate, view_key_register, view_key_forget, view_key_remove
- **Recovery administrator:** home_reset, backup_create, backup_clean, backup_restore

## Configuration

Plugin config is operator-owned. Agent configuration tools mutate HOME config only.
`smartclaws_setup_status` reports when plugin overrides shadow HOME fields.

```jsonc
{
  "smartclawsHome": "~/.smartclaws", // optional; defaults to SMARTCLAWS_HOME or ~/.smartclaws
  "network": "base-testnet",
  "rpcUrl": "https://...",           // privileged override; HTTP(S) only
  "chainId": 324705682,
  "registryAddress": "0x...",
  "allowPrivateRpc": false,          // required to target loopback/private/metadata hosts
  "maxDiscoveryPageSize": 100,
  "maxSyncEntities": 1000,
  "maxReadMessages": 100,
  "maxChannelCapacityBytes": "16777216"
}
```

Custom RPC is privileged: HTTP(S) only, no embedded credentials, and loopback /
private / link-local / metadata destinations are blocked unless `allowPrivateRpc`
is true. Limits have hard internal ceilings even if configured higher.

### Viewing keys

Disclosure decrypts with a **viewing key**, which must be generated separately
from the wallet's signing key. The registry stores whatever public key an
account registers and does not prove ownership, so the two can disagree. Check
`smartclaws_wallet_info.registeredKeyOpensDisclosures` before disclosing.

Rotating a viewing key abandons in-flight disclosures. Backups contain the signing
key; results never include paths or private keys.

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
`bun test` runs unit tests. `bun run test:integration` needs Anvil.
