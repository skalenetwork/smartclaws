# OpenClaw Agent Orchestration Notes

This note captures the OpenClaw behavior relevant to SmartClaws demo agents.
It exists so future SmartClaws agents do not confuse a child run with a
separate device agent.

Sources used:

- OpenClaw agents CLI: https://docs.openclaw.ai/cli/agents
- OpenClaw agent runtime: https://docs.openclaw.ai/concepts/agent
- OpenClaw sub-agents: https://docs.openclaw.ai/tools/subagents
- OpenClaw scheduled tasks: https://docs.openclaw.ai/automation/cron-jobs
- Multi-agent routing guide: https://openclawdoc.org/ko-KR/concepts/multi-agent

## Core Concepts

### Persistent Agent Profile

A persistent OpenClaw agent is created with `openclaw agents add`.

It has:

- its own workspace, such as `~/.openclaw/workspace-smartclaws-shelly-publisher`
- its own state directory under `~/.openclaw/agents/<agentId>/agent`
- its own session store under `~/.openclaw/agents/<agentId>/sessions`
- optional per-agent model, identity, bindings, and visible skills

Use this when SmartClaws needs a named role like:

- `smartclaws-shelly-publisher`
- `smartclaws-shelly-master`
- `smartclaws-price-feed`

Command shape:

```bash
openclaw agents add <agentId> --workspace <workspace-dir> --non-interactive
openclaw agents list --bindings
```

The agent id `main` is reserved.

### Sub-Agent Run

A sub-agent is a background run spawned from an existing agent session.
It is not automatically a new persistent persona unless it targets a persistent
agent id.

OpenClaw supports:

- slash command: `/subagents spawn <agentId> <task>`
- tool route: `sessions_spawn`

Useful properties from the official docs:

- spawning is non-blocking and returns a run id immediately
- completion is push-based; do not build polling loops to wait
- the child run announces a final result back to the requester
- a run has its own session key, e.g. `agent:<agentId>:subagent:<uuid>`
- `sessions_spawn` can target a specific `agentId` if allowed
- `sessions_spawn` supports `thread: true` and `mode: "session"` for
  persistent thread-bound sessions where supported

Use this to start work under an already-created persistent profile.

### Cron Job

OpenClaw cron is the Gateway scheduler. It is for recurring or delayed work,
not for creating an agent profile.

Useful properties:

- jobs persist under `~/.openclaw/cron/jobs.json`
- executions create background task records
- `--session current`, `--session isolated`, and custom sessions have different
  context behavior
- cron can target a specific agent with `--agent <agentId>`

For SmartClaws, cron should be an explicit operator opt-in. It is appropriate
for "run one publisher cycle every minute" after the agent has been set up.

## SmartClaws Pattern

Use this sequence for device agents:

1. Create or verify a persistent OpenClaw agent with `openclaw agents add`.
2. Give the agent its own workspace.
3. Make only the needed SmartClaws skill visible in that workspace.
4. Seed `AGENTS.md` or equivalent workspace notes with absolute paths to the
   SmartClaws repo, skill, and reference files.
5. Start the agent with `sessions_spawn` or `/subagents spawn`, targeting the
   persistent `agentId`.
6. Let the target agent do device work. The parent/orchestrator only observes
   status and coordinates handoff.

## What Belongs Where

Put these in `dev/startup-*.md` files:

- parent/orchestrator instructions
- how to create or reuse the OpenClaw agent profile
- how to make the skill visible
- the first task to send to the target agent
- handoff and success criteria

Put these in `skills/**/SKILL.md` files:

- the target agent's role and boundaries
- required environment
- preflight checks
- operational commands
- runtime loop behavior
- safety/guardrails
- failure handling

Put protocol details in `reference.md` files:

- vendor APIs
- endpoint names
- payload fields
- authentication notes
- verified source links

## SmartClaws Demo Agent Roles

### Dumb Device Agent

Example: `smartclaws-shelly-publisher`

Responsibilities:

- read the physical/simulated device
- publish telemetry to SmartClaws
- read incoming command channel
- apply valid commands
- no policy decisions

### Smart Controller Agent

Example: `smartclaws-shelly-master`

Responsibilities:

- read blockchain telemetry/history
- apply policy
- publish command envelopes to a device incoming channel
- explain decisions
- no direct hardware access

## Operational Warnings

- Do not confuse `openclaw agents add` with `/subagents spawn`.
- Do not let the parent agent perform the target agent's device work after
  handoff.
- Do not rely on polling loops to wait for sub-agent completion; OpenClaw
  announces completion.
- Do not share one workspace between agents unless the operator explicitly
  accepts cross-agent state/file coupling.
- Do not enable cron/autopilot from a skill unless the operator explicitly asks.
