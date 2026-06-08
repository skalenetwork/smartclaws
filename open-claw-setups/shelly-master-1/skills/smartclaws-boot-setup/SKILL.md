---
name: smartclaws-boot-setup
description: >
  One-time setup helper for creating a deployed Smartclaws/OpenClaw agent from
  the reusable setup package. Collects operator answers, drafts the resulting
  file changes, applies them only after confirmation, verifies the setup, and
  removes boot-only artifacts.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🧰"
    homepage: https://github.com/skalenetwork/smartclaws
---

# Smartclaws Boot Setup

This skill runs only during first boot. Its job is to help setting up the openclaw agent

Do not read secrets. Never open `controller/config.json`,
`controller/wallets/`, or any key material. Do not follow the `controller`
symlink to inspect its contents. Ask for symlink targets as operator-provided
paths instead.

## Files Managed

Source templates:

- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `USER.md`
- `POLICY.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- `skills/smartclaws-shelly-master/`
- `skills/smartclaws-shelly-read/`
- `skills/smartclaws-thermal-read/`
- `skills/smartclaws-tariff-read/`
- `skills/smartclaws-shelly-write/`
- `skills/smartclaws-publish-decisions/`

Never copy `.openclaw/`, `memory/*.md`, `MEMORY.md`, controller secrets, wallet
files, or live symlink targets into the deployed agent.

## Questionnaire

Collect these answers before drafting any changes.

### Operator Identity

Ask:

- Operator name of record.
- What the agent should call the operator in refusal/contact text.
- Operator timezone.

Default from this template:

- Operator display name: ask the operator
- Timezone: `WEST (Europe/Lisbon)`
- Refusal/contact wording: ask the named operator.

Apply to `USER.md`, `AGENTS.md`, `POLICY.md`, and skill text that says to ask
the operator.

### Agent Identity

Ask:

- Agent name.
- Short name for text where the full name is too heavy.
- Device or demo label.
- Emoji/avatar preference, if any.

Default from this template:

- Agent name: `Smartclaws Master`
- Short name: `Smartclaws`
- Device/demo label: `SmartClaws Shelly energy-flex demo`
- Emoji: current template values.

Apply to `IDENTITY.md`, `AGENTS.md`, `SOUL.md`, and skill titles/descriptions.
Do not rename skill directory names unless the operator explicitly requests a
larger refactor.

### Local Paths And Symlinks

Ask:

- Workspace root path for this deployed agent.
- OpenClaw agent ID for this deployment (default: `main`).
- Target path for the `controller` symlink.
- Target path for the `bin/smartclaws` symlink.
- Whether `openclaw` is available on `PATH`.

Defaults from this template:

- Workspace root: current deployed workspace root.
- OpenClaw agent ID: `main`.
- `bin/smartclaws` is a symlink to the Smartclaws CLI build.
- `controller` is a symlink to the local controller home.
- `openclaw` is expected on `PATH`.

Apply path answers to Markdown templates and skill command snippets. Create or
update symlinks only after operator confirmation. Do not inspect the controller
target during setup.

### On-Chain Channels

Ask only for addresses:

- Shelly outgoing telemetry channel.
- Shelly incoming command channel.
- Thermal outgoing telemetry channel.
- Agent outgoing decision-log channel.

Do not ask about data schemas, topics, command payloads, response shapes, or
command formats. Keep those exactly as the reusable skills define them.

### Clawbits Mode

Ask whether this deployed agent will be connected to Clawbits.

Default: yes.

Clawbits is a message delivery layer. The agent recognizes a Clawbits session
by its context and applies fail-closed policy: only `agent:{{OPENCLAW_AGENT_ID}}:main` is
privileged — Clawbits sessions are always read-only, regardless of who sends
the message. No special session key pattern is needed; the gate is simply the
main session key.

If no (not using Clawbits):

- Ask for the operator-approved session key(s) for policy changes and manual
  relay commands.
- Remove any Clawbits-specific denial wording from policy/permission files.
- Preserve fail-closed authorization, no identity override, no password or
  challenge phrase, no secret access, and all hard safety rules.

### Policy Defaults

Show the current defaults and ask whether to change them:

- `T_LOW=22`: comfort floor in Celsius; below this, heat should turn on.
- `T_HIGH=24`: comfort ceiling in Celsius; above this, heat should turn off.
- `COOLDOWN_S=900`: minimum spacing between opposite relay commands to avoid
  flapping.
- `PREHEAT_HORIZON_S=`: optional limit for how far ahead preheat decisions may
  look; blank lets the controller reason from available conditions.
- `WAKE_MIN_S=`: optional minimum scheduling cadence; blank lets the controller
  choose.
- `WAKE_MAX_S=`: optional maximum scheduling cadence; blank lets the controller
  choose.
- Goals text: standing guidance for comfort, cost savings, and timing tradeoffs.

Apply only IoT/control settings. Reject any policy text that weakens
`AGENTS.md`, expands the agent scope, stores private contact details, or changes
non-control behavior.

## Replacement Map

Replace these placeholders in copied template files:

- `{{AGENT_NAME}}`
- `{{AGENT_EMOJI}}`
- `{{AGENT_AVATAR}}`
- `{{DEVICE_LABEL}}`
- `{{OPERATOR_DISPLAY_NAME}}`
- `{{OPERATOR_TIMEZONE}}`
- `{{WORKSPACE_ROOT}}`
- `{{OPENCLAW_AGENT_ID}}`
- `{{SHELLY_OUTGOING_CHANNEL}}`
- `{{SHELLY_INCOMING_CHANNEL}}`
- `{{THERMAL_OUTGOING_CHANNEL}}`
- `{{AGENT_OUTGOING_CHANNEL}}`

Keep these values fixed unless a later template revision says otherwise:

- publish identity `--from controller`
- decision-log publish identity `--from smartclaws-master`
- cron job name `smartclaws-master-cycle`
- cron session mode `--session isolated`
- cron delivery mode `--no-deliver`
- telemetry topics, command topics, payload shapes, and response schemas

## Draft Before Applying

Before changing live files, present a concise setup summary:

- operator identity values
- agent identity values
- workspace root and symlink targets
- channel addresses
- Clawbits mode and resulting session allowlist
- policy defaults
- files and symlinks that will be created or overwritten

Ask for explicit confirmation. If confirmation is not clear, stop without
applying changes.

## Apply After Confirmation

After confirmation:

1. Substitute all `{{PLACEHOLDER}}` values in the root Markdown template files
   in place (AGENTS.md, IDENTITY.md, SOUL.md, USER.md, POLICY.md, TOOLS.md,
   HEARTBEAT.md).
2. Substitute all `{{PLACEHOLDER}}` values in the runtime skills under `skills/`
   in place, excluding `skills/smartclaws-boot-setup/`.
3. Create the `bin/` directory if it doesn't exist: `mkdir -p {{WORKSPACE_ROOT}}/bin`.
   Then create or update `bin/smartclaws` and `controller` symlinks using the
   operator-provided targets.
4. Leave `memory/` empty or create it without copying old session history.
5. Do not create or inspect wallet/config files.

Use recoverable operations when replacing existing files where possible. Never
use destructive commands without operator confirmation.

## Verify

Verify after applying:

- root Markdown files exist.
- runtime skills exist under `skills/`.
- `bin/smartclaws` and `controller` are symlinks with the expected targets.
- no `{{...}}` placeholders remain in live root Markdown files or runtime
  skills.
- no stale current-deployment literals remain, especially the old operator
  name, old workspace path, old channel addresses, or old symlink targets.
- if Clawbits mode is disabled, no Clawbits-specific denial wording remains in
  live policy/permission files.

## Cleanup

After successful verification, delete only boot artifacts:

- root `BOOT.md`
- `skills/smartclaws-boot-setup/`
