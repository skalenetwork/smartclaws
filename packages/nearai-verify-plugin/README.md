# nearai-verify-openclaw-plugin

An [OpenClaw provider plugin](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
that proves NEAR AI Cloud **direct** completions were signed inside an attested
TEE. It owns the transport for `nearai` direct-completions routes, hashes the
exact request and response bytes, and verifies the TEE signature and attestation
chain **asynchronously** — verification never blocks a turn (observation only).

Unlike the SmartClaws tool plugin, this is a provider transport plugin: its
`openclaw.plugin.json` manifest is authored by hand, and `viem` plus
`@phala/dcap-qvl` are runtime dependencies (`openclaw` is a peer).

## What it proves

Each completion is classified with an evidence level:

| Evidence | Meaning |
| --- | --- |
| `CLAIMED` | No usable proof (e.g. gateway route, or a check failed). |
| `ATTESTED` | The signature verified against a valid TEE quote. |
| `PROVEN` | The signature over the exact request/response bytes verified, and the recovered signer is bound to an attested TEE `report_data`. |

Only direct `*.completions.near.ai` `openai-completions` routes are eligible for
`PROVEN`. Gateway and non-NEAR endpoints are explicitly recorded as `SKIP`.

## Command

```text
/nearai-verify [latest|<chat_id>]
```

Shows TEE verification results for the current session. Results never include
request/response bodies or API keys.

## Agent tools

The plugin also exposes two read-only, session-scoped tools:

| Tool | Purpose |
| --- | --- |
| `nearai_list_chat_ids` | List chat IDs with settled verification results, newest first. |
| `nearai_verify` | Read the result for `latest` or an exact chat ID. |

These tools let an agent respond to natural-language requests such as “verify
your latest response.” They only read verification performed outside the model;
they cannot trigger, alter, or fabricate evidence.

## Configuration

Plugin config (in the OpenClaw Gateway config entry):

```jsonc
{
  "enforcement": "observe" // only observation mode is supported in this release
}
```

The provider credential is read from the operator's existing `nearai` provider
under `models.providers`; its per-model direct base URLs are authoritative and
are never rewritten to a gateway.

Credential env var: `NEAR_AI_API_KEY`.

## Install

Published package:

```bash
openclaw plugins install clawhub:nearai-verify-openclaw-plugin
openclaw plugins inspect nearai-verify --runtime
```

Local checkout:

```bash
openclaw plugins install ./packages/nearai-verify-plugin
openclaw plugins inspect nearai-verify --runtime
```

Restart or reload the OpenClaw Gateway after installing or updating the plugin.

## Build & test

```bash
cd packages/nearai-verify-plugin
bun run build   # bundle src/index.ts -> dist/index.js
bun run check   # tsc --noEmit
bun test        # unit, orchestration, manifest, smoke, and dependency-audit tests
```

The manifest is hand-authored; `bun test` includes a consistency check that keeps
`openclaw.plugin.json` and `package.json` in sync, a registration smoke test, and
a dependency audit that rejects the vulnerable `@phala/dcap-qvl-node` line
(GHSA-796p-j2gh-9m2q) and any `@phala/dcap-qvl` below its patched `0.3.9` floor.
