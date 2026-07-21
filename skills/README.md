# SmartClaws Skills

Reusable OpenClaw skills for SmartClaws. The executable integration lives in the
`smartclaws-openclaw-plugin`; skills do not install or build the CLI. Each skill
is published to ClawHub on its own and installed with `clawhub install <slug>`.

## Catalog

| Skill (slug) | Path | Requires plugin | Purpose |
| --- | --- | --- | --- |
| `smartclaws` | `smartclaws/` | no (bootstraps it) | Entry point: teaches SmartClaws and guides self-setup. |
| `smartclaws-master-agent` | `operational/smartclaws-master-agent/` | yes | Role skill for controller/orchestrator agents. |
| `smartclaws-bridge-agent` | `operational/smartclaws-bridge-agent/` | yes | Role skill for hardware/API bridge agents. |
| `smartclaws-device-shelly-plug-s-gen3` | `devices/shelly-plug-s-gen3/` | yes | Device contract: Shelly Plug S Gen3. |
| `smartclaws-device-thermal-room-sensor` | `devices/thermal-room-sensor/` | yes | Device contract: telemetry-only room thermal sensor. |
| `smartclaws-device-novapm-sds011` | `devices/novapm-sds011/` | yes | Device contract: NovaPM / SDS011 air-quality sensor. |
| `smartclaws-tariff-file-source` | `sources/tariff-file-source/` | no | Local tariff snapshot contract for master agents. |

Every plugin-backed skill except `smartclaws` declares
`metadata.openclaw.requires.config: ["plugins.entries.smartclaws"]`, so it loads
only when the SmartClaws plugin is configured. The `smartclaws` onboarding skill
is the exception — it runs *before* the plugin exists in order to help install it.
`smartclaws-tariff-file-source` is also an exception because it describes a
local/off-chain file source, not a SmartClaws plugin tool.

## How an agent uses these

1. Install and run the `smartclaws` skill to learn the framework and set up
   (plugin, wallet, on-chain identity, role).
2. Install the role skill that matches the chosen mode
   (`smartclaws-master-agent` or `smartclaws-bridge-agent`).
3. Install a device contract skill for every device read or commanded.
4. Record deployment wiring in a workspace-root `SMARTCLAWS.md` (see
   `smartclaws/templates/SMARTCLAWS.example.md`).
5. Adopt an owner-owned operating contract from
   `smartclaws/templates/AGENTS.controller.md` or `AGENTS.bridge.md`.

## What these skills deliberately do NOT contain

- No hardcoded channel addresses, wallets, or deployment specifics.
- No hard policy, comfort bands, permission allowlists, or "hard law." How an
  agent behaves and what it is allowed to do is the **owner's** call — the
  `smartclaws` skill ships example `AGENTS.md` templates (behaviour + structure
  only, with an empty owner-guidelines slot) and nothing more.

Deployment-specific, owner-owned agent workspaces (with their own AGENTS.md,
channels, and any policy) live outside this directory — see `open-claw-setups/`
for worked examples.
