# SmartClaws Review Notes

SmartClaws is an on-chain IoT messaging stack on SKALE. Devices, controllers,
and OpenClaw agents communicate through append-only SmartClaws channels with
contract-enforced roles.

## Architecture

- `smart-contracts/`: Hardhat 3, ESM, Solidity 0.8.28, OpenZeppelin 5.
- `packages/core/`: shared types, envelope encoding, names, networks, ABI JSON.
- `packages/sdk/`: TypeScript SDK for config, wallets, discovery, reads, writes,
  role grants, and backups.
- `packages/cli/`: `smartclaws` CLI built on the SDK.
- `packages/openclaw-plugin/`: OpenClaw tools for setup, identity, publish/read/disclose, authority, keys, and recovery.
- `skills/`: ClawHub-published onboarding, operational, and device skills.
- `open-claw-setups/`: example agent workspace templates.
- `dev/`: local hardware/simulation helpers only.

## Review Priorities

Flag changes that break these invariants:

- Devices publish telemetry through `SmartClawsDevice.publishTelemetry`; masters
  send commands through `SmartClawsDevice.publishCommand`.
- Agents publish decision logs through `SmartClawsAgent.publishOutbound`; other
  agents/controllers notify them through `SmartClawsAgent.publishInbound`.
- Do not reintroduce direct raw writes to agent-owned channels for normal agent
  publish/notify flows.
- Device roles are `publisher` and `master`; agent roles are `publisher`,
  `sender`, and `agent-admin`.
- CLI, SDK, plugin, ABI, docs, and tests should stay in sync when contracts or
  public tool/command names change.
- Use viem in TypeScript chain code. Solidity should use custom errors instead
  of revert strings.

## CI Commands

```bash
bun install
bun run build:packages
bun run build:cli
bun run test:sdk
bun run test:plugin
bun run test:cli
bun run test:contracts
bun run lint
```

After contract changes, regenerate ABI JSON with `bun run export-abi`; do not
edit `packages/core/abi/*.json` by hand.

## OpenClaw Publishing

- Plugin package: `openclaw plugins install clawhub:smartclaws-openclaw-plugin`.
- Skills install by slug, e.g. `clawhub install smartclaws`,
  `smartclaws-master-agent`, `smartclaws-bridge-agent`, and device skills.
- The plugin is published as a ClawHub `code-plugin`; skills are published as
  ClawHub skills. Do not mix the install commands.
- Published plugin/skill docs, manifests, versions, and CI workflows should
  match current slugs and package names.

## Review Red Flags

- Never commit or print wallet private keys, `wallets/default.json`,
  `controller/wallets/`, or SmartClaws backups.
- Do not allow docs or scripts to reference removed helpers or old workaround
  flows such as standalone agent decision channels.
- Keep demo docs aligned with current CLI flows: `agent register`, `agent publish`,
  `agent notify`, `device grant`, and `agent grant`.
- Treat `dist/`, generated ABIs, and published manifests as build outputs unless
  the relevant build/manifest command updates them.
- Prefer actionable review comments on correctness, security, compatibility, and
  missing tests over broad style feedback.
