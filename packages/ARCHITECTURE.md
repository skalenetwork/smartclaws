# SmartClaws Packages Architecture

This is the package-level memory reference for agents working in `packages/`.
It captures the current SmartClaws package boundaries, the OpenClaw tool plugin
architecture, and the maintenance rules that keep the CLI, SDK, dashboard, and
agent tools aligned.

## Current Package Map

```text
packages/core/
  Pure SmartClaws primitives: ABI files, envelope encoding/decoding, network
  definitions, name helpers, and shared types.

packages/sdk/
  Provider-agnostic service layer: config and wallet loading, local device and
  agent records, viem contract clients, typed errors, and structured services.

packages/cli/
  Command-line presentation layer. Commander commands parse flags, call SDK
  services or local helpers, and print user-facing output.

packages/openclaw-plugin/
  OpenClaw tool plugin. Defines agent-callable tools with typebox schemas and
  delegates SmartClaws behavior to the SDK.

packages/dashboard/
  Vite/React dashboard for inspecting and managing SmartClaws data.
```

The intended dependency flow is:

```text
core -> sdk -> cli
core -> sdk -> openclaw-plugin
core -> dashboard
```

Keep provider or UI concerns out of `core` and `sdk`. The SDK should remain the
shared service boundary for code that needs typed params in and structured data
out.

## Chosen Agent Architecture

SmartClaws exposes OpenClaw integration as a tool plugin:

```text
OpenClaw agent
  -> SmartClaws OpenClaw tool plugin
  -> @smartclaws/sdk service functions
  -> @smartclaws/core primitives and ABI
  -> SKALE contracts
```

Use an OpenClaw tool plugin when adding agent-callable tools. Do not model this
as a channel, model provider, hook, service, or setup backend unless the
integration truly needs those OpenClaw extension points.

Device skills should stay thin and domain-specific. They should require the
SmartClaws plugin, name the tool to call, and describe the domain payload. They
should not install SmartClaws, build the CLI, manage wallets directly, or run
shell snippets for normal SmartClaws operations.

Example skill-level instruction:

```text
Requires the SmartClaws plugin.
Publish PM telemetry with smartclaws_publish.
Topic: telemetry.pm
Payload: { "pm25": number, "pm10": number, "unit": "ug_m3" }
```

## Package Boundaries

### `@smartclaws/core`

`core` owns reusable primitives that have no runtime provider dependency:

- Smart contract ABI JSON under `abi/`.
- Envelope encode/decode logic.
- Network defaults.
- Name helpers.
- Shared types.

Keep this package small and deterministic. It should not know about Commander,
OpenClaw, React, filesystem layout beyond shared types, or wallet signing flows.

### `@smartclaws/sdk`

`sdk` is the provider-agnostic runtime layer. It is consumed by the CLI and by
agent/plugin packages.

The current service pattern is:

```text
typed params -> SDK service -> structured result or SmartClawsError
```

Examples:

- `resolveChannel({ device } | { channel }, homeDir)` resolves a local device or
  direct channel target.
- `readMessages(...)` reads and decodes channel messages without a wallet.
- `publishMessage(...)` signs a transaction and returns transaction metadata.
- `getWalletInfo(...)` returns wallet address and balance, never private keys.

SDK functions should avoid console output and process exits. Return structured
objects and throw typed `SmartClawsError` values.

### `@smartclaws/cli`

`cli` is a presentation layer. Commander command handlers can parse flags and
print output, but reusable behavior belongs in `sdk`.

Preferred shape:

```text
packages/cli/src/commands/*.ts
  -> parse CLI flags and print output only

packages/sdk/src/services/*.ts
  -> load config, call contracts, return structured data

packages/openclaw-plugin/src/tools/*.ts
  -> validate tool params and call the same service functions
```

Avoid copying business logic from CLI commands into the plugin. Extract it to
the SDK first when an agent tool and CLI command need the same operation.

### `smartclaws-openclaw-plugin`

`packages/openclaw-plugin` is the OpenClaw binding. It should remain thin:

- Define plugin metadata with `defineToolPlugin`.
- Define config and parameter schemas with `typebox`.
- Resolve plugin config into SDK config.
- Call SDK services.
- Return JSON-compatible results.

It currently exposes:

| Tool | Mode | Notes |
| --- | --- | --- |
| `smartclaws_wallet_info` | read | Returns address and balance; never returns a private key. |
| `smartclaws_read` | read | Reads decoded channel messages. No wallet required. |
| `smartclaws_publish` | write, optional | Publishes an envelope and returns transaction status. |

Tool names are stable public API. Keep them lowercase, unique, specific, and
backward-compatible once released.

## OpenClaw Plugin Requirements

An OpenClaw tool plugin package needs:

- Node `>=22`.
- TypeScript ESM output.
- `typebox` for plugin config and tool parameter schemas.
- `openclaw >=2026.5.17` as a peer dependency.
- A package root that ships `dist/`, `openclaw.plugin.json`, `package.json`,
  and usually `README.md`.
- Built JavaScript as the runtime entry, normally `./dist/index.js`.
- `typebox` in `dependencies`, not only `devDependencies`, because the built
  plugin imports it at runtime.

The current plugin package bundles `@smartclaws/core`, `@smartclaws/sdk`, and
`viem` into `dist/index.js`, while keeping `openclaw` and `typebox` external.

Expected package metadata shape:

```json
{
  "type": "module",
  "files": ["dist", "openclaw.plugin.json", "README.md"],
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "openclaw": ">=2026.5.17"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
```

## Plugin Runtime Entry

The plugin entry uses `defineToolPlugin`:

```ts
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { ConfigSchema } from "./plugin-config.js";
import { smartClawsTools } from "./tools/index.js";

export default defineToolPlugin({
  id: "smartclaws",
  name: "SmartClaws",
  description: "Publish and read IoT telemetry on SKALE through SmartClaws.",
  configSchema: ConfigSchema,
  activation: { onStartup: true },
  tools: smartClawsTools,
});
```

Return strings only when the model should see exact text. For SmartClaws tools,
prefer structured JSON-compatible objects so agents and skills can inspect
fields such as `txHash`, `status`, `channel`, `offset`, `messages`, and
`address`.

Use `optional: true` for tools that should be explicitly allowlisted before they
are sent to a model. Signing/write tools such as `smartclaws_publish` should
remain optional.

## Plugin Configuration

Current plugin config fields:

- `smartclawsHome`: optional SmartClaws config directory. Defaults to
  `SMARTCLAWS_HOME` or `~/.smartclaws`.
- `network`: optional default network. Currently supports `base-testnet`.
- `rpcUrl`: optional RPC override.
- `chainId`: optional chain ID override. Required with `rpcUrl` when no network
  is set.
- `registryAddress`: optional registry contract override.

The plugin should prefer an existing `smartclaws init` config file, then apply
plugin config overrides. If no local config exists, plugin config can bootstrap
one from `network` or from `rpcUrl` plus `chainId`.

Private keys stay in the SmartClaws wallet file. No tool should ever return or
log a private key.

## Manifest Rules

`openclaw.plugin.json` is generated from the built entry:

```bash
cd packages/openclaw-plugin
bun run build
bun run manifest
```

It must include `contracts.tools` so OpenClaw can discover tools without loading
the plugin runtime.

Regenerate the manifest after changing:

- Plugin id, name, description, activation, or config schema.
- Tool names or tool metadata that appears in generated plugin metadata.
- The runtime entry path.

Use `manifest:check` in CI or before publishing to catch stale metadata:

```bash
cd packages/openclaw-plugin
bun run build
bun run manifest:check
bun run validate
```

## Build And Validation

From the repo root:

```bash
bun run build:packages
bun run plugin:manifest:check
bun run plugin:validate
bun run test:sdk
bun run test:cli
```

Validation checks should confirm:

- `openclaw.plugin.json` exists and loads.
- The runtime entry exports `defineToolPlugin` metadata.
- Manifest fields match entry metadata.
- `contracts.tools` matches declared tool names.
- `package.json` points `openclaw.extensions` at the selected runtime entry.

For local OpenClaw inspection:

```bash
openclaw plugins install ./packages/openclaw-plugin
openclaw plugins inspect smartclaws --runtime
```

For package smoke testing:

```bash
cd packages/openclaw-plugin
npm pack
openclaw plugins install npm-pack:./smartclaws-openclaw-plugin-0.1.0.tgz
openclaw plugins inspect smartclaws --runtime --json
```

Restart or reload the OpenClaw Gateway after installing the plugin.

## Planned Tool Surface

Start small and keep tool contracts stable.

Implemented:

- `smartclaws_wallet_info`
- `smartclaws_read`
- `smartclaws_publish`

Likely future read/status tools:

- `smartclaws_list_devices`

Likely future setup/write tools:

- `smartclaws_init`
- `smartclaws_register_group`
- `smartclaws_register_device`
- `smartclaws_authorize_publisher`

Write tools should be optional and should return transaction hashes, receipt
status, and relevant addresses.

## SmartClaws HOME Policy

A SmartClaws HOME is bound to exactly one wallet address.

Each HOME contains one coherent local identity: config, wallet file, attached
groups, devices, agents, channel cache, and discovered capabilities. The CLI
must refuse to operate if `config.walletAddress` does not match the wallet stored
in `wallets/default.json`.

For now, multiple wallets inside one HOME are not supported. To use multiple
wallets on the same machine, users should use separate HOME directories via
`SMARTCLAWS_HOME` or an explicit `--home` option where supported.

Future work may add a friendly home manager:

- `smartclaws home list`
- `smartclaws home create <name>`
- `smartclaws home use <name>`
- `smartclaws home current`

That home manager is intentionally not part of this implementation.

## Troubleshooting

If a tool does not appear:

1. Run `openclaw plugins inspect smartclaws --runtime`.
2. Run `openclaw plugins validate --root ./packages/openclaw-plugin --entry ./dist/index.js`.
3. Check that `openclaw.plugin.json` has the expected `contracts.tools`.
4. Check that `package.json` has `openclaw.extensions: ["./dist/index.js"]`.
5. Restart or reload the Gateway.

Common issues:

- `plugin entry not found: ./dist/index.js`: run `bun run build`.
- `plugin entry does not expose defineToolPlugin metadata`: ensure the default
  export is the `defineToolPlugin(...)` result.
- `openclaw.plugin.json generated metadata is stale`: rerun `bun run manifest`.
- `Cannot find package 'typebox'`: keep `typebox` in `dependencies`.

## Maintenance Rules For Agents

- Keep `core` provider-neutral and free of CLI/OpenClaw/dashboard concerns.
- Put reusable runtime behavior in `sdk`, not in CLI commands or plugin tools.
- Keep plugin tools thin: schemas, config resolution, SDK call, structured
  return.
- Treat tool names and return shapes as public API.
- Never return private keys or secrets from SDK services or plugin tools.
- Prefer structured errors with `SmartClawsError`.
- After changing plugin metadata or tool names, rebuild and refresh
  `openclaw.plugin.json`.
- When adding a new write/signing tool, mark it `optional: true`.
