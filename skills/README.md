# SmartClaws Skills

Reusable OpenClaw skills for SmartClaws. The executable integration lives in the
`smartclaws-openclaw-plugin`; skills do not install or build the CLI. Release-ready
skills are published to ClawHub on their own and installed with
`clawhub install <slug>`.

## Catalog

| Skill (slug) | Path | Requires plugin | Purpose |
| --- | --- | --- | --- |
| `smartclaws` | `smartclaws/` | no (bootstraps it) | Entry point: teaches SmartClaws and guides self-setup. |
| `smartclaws-master-agent` | `operational/smartclaws-master-agent/` | yes | Role skill for controller/orchestrator agents. |
| `smartclaws-bridge-agent` | `operational/smartclaws-bridge-agent/` | yes | Role skill for hardware/API bridge agents. |
| `smartclaws-device-shelly-plug-s-gen3` | `devices/shelly-plug-s-gen3/` | yes | Device contract: Shelly Plug S Gen3. |
| `smartclaws-device-thermal-room-sensor` | `devices/thermal-room-sensor/` | yes | Device contract: telemetry-only room thermal sensor. |
| `smartclaws-device-novapm-sds011` | `devices/novapm-sds011/` | yes | Source-only TODO: restore the executable SDS011 adapter before publishing. |
| `smartclaws-tariff-file-source` | `sources/tariff-file-source/` | no | Local tariff snapshot contract for master agents. |
| `nearai-verify` | `operational/nearai-verify/` | no | Check whether the agent's model endpoints are NEAR AI TEE endpoints. |

Every plugin-backed skill except `smartclaws` declares
`metadata.openclaw.requires.config: ["plugins.entries.smartclaws"]`, so it loads
only when the SmartClaws plugin is configured. The `smartclaws` onboarding skill
is the exception — it runs *before* the plugin exists in order to help install it.
`smartclaws-tariff-file-source` is also an exception because it describes a
local/off-chain file source, not a SmartClaws plugin tool.

`nearai-verify` is independent of SmartClaws entirely — it inspects OpenClaw's
own model configuration and gateway logs, and is useful to any OpenClaw user
running against NEAR AI Cloud.

## How an agent uses these

The `smartclaws` skill is the path from "nothing" to a **working agent of one
job** (group-master, device-master, device-bridge, or user-proxy). Iterate
with the owner until it can say it has everything as that job. Current plugin
tools (`smartclaws_setup_status`, initialize, register, keys, …) are the HOME
runtime — not the old CLI-only setup, and not copying
`open-claw-setups/shelly-master-1` custom skills.

1. Run `smartclaws` / `SETUP.md`. Follow `smartclaws_setup_status` until HOME
   is `ready`, then keep going through goal, wiring, and `AGENTS.md`.
2. Install the role skill that matches the chosen mode
   (`smartclaws-master-agent` or `smartclaws-bridge-agent`).
3. Install a device contract skill for every device read or commanded.
4. Record deployment wiring **and the owner's goal** in a workspace-root
   `SMARTCLAWS.md` (see `smartclaws/templates/SMARTCLAWS.example.md`).
5. Adopt an owner-owned operating contract from
   `smartclaws/templates/AGENTS.controller.md` or `AGENTS.bridge.md`.
6. Only then operate with the role skill. If anything is still missing, go
   back to `SETUP.md` rather than guessing.

## What these skills deliberately do NOT contain

- No hardcoded channel addresses, wallets, or deployment specifics.
- No hard policy, comfort bands, permission allowlists, or "hard law." How an
  agent behaves, **what it is trying to achieve**, and what it is allowed to do
  is the **owner's** call. The `smartclaws` skill interviews for a `goal`
  during setup, writes it into `SMARTCLAWS.md`, and ships example `AGENTS.md`
  templates (behaviour + structure, with an empty extra-guidelines slot).

Deployment-specific, owner-owned agent workspaces live outside this directory
(`open-claw-setups/` and live OpenClaw workspaces). They show what *done*
looks like. Grow that completeness with the current plugin tools and these
reusable skills — do not copy their hardcoded channels or CLI-era custom skills.
