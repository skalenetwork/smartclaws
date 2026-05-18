# Create The Shelly Publisher Agent

This file is for the existing OpenClaw operator agent.
It creates and starts a separate Shelly publisher agent. Do not use this as the
publisher agent's own prompt.

## Fixed Target

```text
agentId: smartclaws-shelly-publisher
workspace: ~/.openclaw/workspace-smartclaws-shelly-publisher
skill: skills/smartclaws-shelly-plug-s-gen3/smartclaws-shelly-publisher/SKILL.md
reference: skills/smartclaws-shelly-plug-s-gen3/reference.md
smartclaws home: ~/.sc-publisher
device name: shelly-plug-s
smartclaws binary: packages/cli/dist/smartclaws
state file: ~/.sc-publisher/state/shelly-publisher-state.json
event log: ~/.sc-publisher/state/shelly-publisher-events.jsonl
event append helper: ~/.sc-publisher/bin/shelly-log-event
```

## Step 1 - Verify Local Publisher Setup

Run from the SmartClaws repo root:

```bash
SMARTCLAWS_HOME=~/.sc-publisher packages/cli/dist/smartclaws device list
```

If this does not show `shelly-plug-s` with outgoing and incoming channels, stop
and report the missing publisher setup. Do not create the OpenClaw agent yet.

## Step 2 - Create Or Reuse The OpenClaw Agent

Check whether the target agent exists:

```bash
openclaw agents list --json
```

If `smartclaws-shelly-publisher` is missing, create it:

```bash
openclaw agents add smartclaws-shelly-publisher \
  --workspace ~/.openclaw/workspace-smartclaws-shelly-publisher \
  --non-interactive
```

Do not use the main agent workspace for this publisher.

## Step 3 - Apply The Publisher Agent Config

The operator agent must configure the new agent as a small, low-memory edge
bridge. Do not leave this as manual follow-up.

Find the new agent's index in the OpenClaw config:

```bash
REPO="$(pwd)"
REPO_JSON="$(jq -nc --arg repo "$REPO" '$repo')"

AGENT_INDEX="$(openclaw config get agents.list --json \
  | jq -r 'to_entries[] | select(.value.id == "smartclaws-shelly-publisher") | .key')"

if [ -z "$AGENT_INDEX" ]; then
  echo "smartclaws-shelly-publisher is missing from agents.list"
  exit 1
fi
```

Apply only these narrow per-agent settings:

```bash
openclaw config set "agents.list[$AGENT_INDEX].workspace" \
  '"~/.openclaw/workspace-smartclaws-shelly-publisher"' \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].repoRoot" \
  "$REPO_JSON" \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].skills" \
  '["smartclaws-shelly-publisher"]' \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].contextInjection" \
  '"continuation-skip"' \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].startupContext" \
  '{"enabled":false}' \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].contextLimits" \
  '{"memoryGetMaxChars":10000,"memoryGetDefaultLines":100,"toolResultMaxChars":6000,"postCompactionMaxChars":5000}' \
  --strict-json

openclaw config set "agents.list[$AGENT_INDEX].skillsLimits" \
  '{"maxSkillsPromptChars":28000}' \
  --strict-json

openclaw config validate
```

If any config write or validation step fails or seems incorrect, stop and report the exact failure.
Do not start the publisher agent with a broad/default context.

## Step 4 - Attach Only The Publisher Skill

Run from the SmartClaws repo root:

```bash
REPO="$(pwd)"
WORKSPACE="$HOME/.openclaw/workspace-smartclaws-shelly-publisher"
SKILL_LINK="$WORKSPACE/skills/smartclaws-shelly-publisher"

mkdir -p "$WORKSPACE/skills"
if [ ! -e "$SKILL_LINK" ]; then
  ln -s "$REPO/skills/smartclaws-shelly-plug-s-gen3/smartclaws-shelly-publisher" "$SKILL_LINK"
fi
```

Create the append-only event helper. The publisher agent must use this helper
for status events instead of reading or editing the event log directly:

```bash
mkdir -p "$HOME/.sc-publisher/bin" "$HOME/.sc-publisher/state"
cat > "$HOME/.sc-publisher/bin/shelly-log-event" <<'PY'
#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone

if len(sys.argv) < 4:
    print("usage: shelly-log-event <level> <stage> <message> [json-details]", file=sys.stderr)
    sys.exit(2)

level, stage, message = sys.argv[1:4]
details = {}
if len(sys.argv) > 4:
    try:
        details = json.loads(sys.argv[4])
    except json.JSONDecodeError as exc:
        print(f"invalid json-details: {exc}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(details, dict):
        print("json-details must be an object", file=sys.stderr)
        sys.exit(2)

path = os.path.expanduser(
    os.environ.get("EVENT_LOG", "~/.sc-publisher/state/shelly-publisher-events.jsonl")
)
event = {
    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "agent": "smartclaws-shelly-publisher",
    "level": level,
    "stage": stage,
    "message": message,
}
for key, value in details.items():
    if key not in event:
        event[key] = value

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(event, separators=(",", ":"), sort_keys=True) + "\n")
PY
chmod +x "$HOME/.sc-publisher/bin/shelly-log-event"
```

Then write this exact workspace note for the new agent:

```bash
cat > "$WORKSPACE/AGENTS.md" <<EOF
You are the SmartClaws Shelly Publisher.

Read these files before acting:
- $REPO/skills/smartclaws-shelly-plug-s-gen3/smartclaws-shelly-publisher/SKILL.md
- $REPO/skills/smartclaws-shelly-plug-s-gen3/reference.md

Use:
- SMARTCLAWS_HOME=~/.sc-publisher
- DEVICE_NAME=shelly-plug-s
- SMARTCLAWS_BIN=$REPO/packages/cli/dist/smartclaws
- STATE_FILE=~/.sc-publisher/state/shelly-publisher-state.json
- EVENT_LOG=~/.sc-publisher/state/shelly-publisher-events.jsonl
- EVENT_APPEND=~/.sc-publisher/bin/shelly-log-event

Cron runs in isolated sessions. Do not rely on inherited shell exports.
Each run must use these constants plus ~/.sc-publisher/state/shelly-publisher-state.json.
Keep runtime state in ~/.sc-publisher/state/shelly-publisher-state.json.
Append compact status events only by running ~/.sc-publisher/bin/shelly-log-event.
Never read, parse, rewrite, truncate, rotate, or summarize the event log before
appending.
These files are operational state and observability logs, not LLM memory.
Do not store telemetry history, channel history, command history, cron job ids,
or registry/channel addresses in chat memory.

You are ONLY an edge bridge. Do not make policy decisions.
EOF
```

## Step 5 - Start The New Agent

Start `smartclaws-shelly-publisher` with this task:

```text
Read your AGENTS.md, then read the Shelly publisher skill and reference file.
Verify the SmartClaws publisher setup with:
  SMARTCLAWS_HOME=~/.sc-publisher <repo>/packages/cli/dist/smartclaws device list
Capture the outgoing and incoming channel addresses for shelly-plug-s.
Discover the Shelly Plug S Gen3 on the LAN using the skill's discovery order.
Persist initial STATE_FILE with device name, incoming channel, outgoing channel,
registry address if available, discovered shelly_host, last_incoming_offset=-1,
cron_enabled=false, and updated_at.
Report the device registration, channel addresses, Shelly discovery result,
auth status, state file path, event log path, and any blocker. Then wait for
operator instructions.
```

Use the OpenClaw mechanism that targets the named agent id
`smartclaws-shelly-publisher`. If you cannot target that agent id, stop and
report that the publisher agent was created but not started.
