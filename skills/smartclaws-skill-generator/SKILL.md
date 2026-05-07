---
name: smartclaws-skill-generator
description: >
  Generate high-quality IoT interaction skills from verified device facts.
  Use when creating or updating a SKILL.md for a real sensor or actuator,
  and when the agent must research first, then generate the final skill file.
license: LGPL-3.0-or-later
compatibility: Requires command-line research tools and file editing access
metadata:
  openclaw:
    emoji: "\U0001F6E0"
    homepage: https://github.com/skalenetwork/smartclaws
---

# SmartClaws Skill Generator

Create a production-grade **two-skill bundle** for IoT control by following a strict order:
1) discover facts, 2) validate facts, 3) design both agent roles, 4) generate files.

Do not generate skills from guesses.

## Hard Rule

Research first, generate last.

Never write final `SKILL.md` files until all required discovery fields are filled and validated.

Always generate **two skills**:

1. **Simple agent skill** (dumb bridge):
   - read device telemetry -> write to SmartClaws outgoing channel
   - read SmartClaws incoming command channel -> apply command to device
2. **Smart agent skill** (policy controller):
   - read telemetry from blockchain outgoing channel
   - decide using policy/instructions
   - write commands to blockchain incoming channel

The smart agent may consume multiple skills (policy, pricing, weather, safety, etc.). Design for composition.

## Inputs You Must Collect Before Generation

For every target device bundle, collect:

- Device identity: vendor, model, hardware revision (if known), and exact use-case.
- Connection path: BLE, serial, USB HID, Wi-Fi API, MQTT, Modbus, I2C/SPI/GPIO, etc.
- Runtime host: OS, Python/Node preference, required permissions/capabilities, service model.
- Data contract:
  - outgoing topics (telemetry/events) with payload schema and cadence
  - incoming topics (commands) with payload schema and actuator behavior
- Transport details:
  - protocol endpoints (UUIDs, registers, paths, topics, ports)
  - pairing/auth requirements and secrets handling expectations
- Failure behavior:
  - retry/backoff, stale-data handling, reconnect policy, timeouts
  - idempotency and duplicate publish behavior
- Verification plan:
  - dry-run command
  - live read/publish checks
  - acceptance criteria for "skill is working"

- Multi-skill composition plan for the smart agent:
  - which additional skills may be consumed
  - what each additional skill provides
  - conflict/precedence rule when skills disagree

If any item is unknown, stop and ask for it or explicitly research it.

## Workflow

Use this exact flow.

### Phase 1 - Discovery

1. Identify the exact device and connection method.
2. Gather official docs and known community references.
3. Extract concrete protocol details (not marketing descriptions).
4. Record all assumptions as `UNVERIFIED` until confirmed.

Deliverable: discovery notes with sources and unresolved questions.

### Phase 2 - Validation

1. Cross-check protocol details against at least two independent sources when possible.
2. Validate host/runtime constraints (permissions, libraries, daemon requirements).
3. Confirm read and write feasibility:
   - can telemetry be read reliably?
   - can control commands be issued safely?
4. Resolve each `UNVERIFIED` item into `VERIFIED` or `BLOCKED`.

Deliverable: a validation table with status per required input.

### Phase 3 - Skill Design

1. Design the **simple agent skill**:
   - setup
   - register
   - read device telemetry loop
   - publish telemetry loop
   - read incoming command loop
   - apply command loop
2. Design the **smart agent skill**:
   - subscribe to outgoing telemetry channels
   - evaluate decision policy
   - publish commands to incoming channel
   - decision logging and cooldown/debounce rules
3. Define shared topic names and payload schemas for both skills.
4. Define config surfaces (`required`, `optional`, defaults) for both skills.
5. Define safety guardrails and "do not fake data" policy.
6. Define test/verification steps and expected outputs.
7. Define smart-agent multi-skill composition contract (inputs, outputs, precedence).

Deliverable: a concise design spec (no code yet).

### Phase 4 - Generate Files

Generate final files only after Phase 1-3 are complete.

Always generate:
- `skills/<device>-publisher/SKILL.md` (simple bridge agent)
- `skills/<device>-reader/SKILL.md` (smart policy agent)

Generate when needed:
- `examples/<device>-publisher.py`
- `examples/mock-publisher.py` (only for explicit simulation/testing)
- `reference.md` for protocol details

## Required Output Templates For Generated Skills

### Template A - Simple Agent Skill (`<device>-publisher`)

Include these sections in order:

1. YAML frontmatter (`name`, `description`, `license`, compatibility metadata)
2. `# <Skill Name>`
3. `## Responsibility` (explicitly "no policy decisions")
4. `## Prerequisites`
5. `## Setup and Registration`
6. `## Device-Specific Protocol Notes`
7. `## Telemetry Mapping`
8. `## Command Mapping`
9. `## Runtime Loop`
10. `## Validation and Test Plan`
11. `## Failure Modes and Recovery`
12. `## Common Errors`

### Template B - Smart Agent Skill (`<device>-reader`)

Include these sections in order:

1. YAML frontmatter (`name`, `description`, `license`, compatibility metadata)
2. `# <Skill Name>`
3. `## Responsibility` (policy and decisions)
4. `## Required Inputs`
5. `## Read Path (Outgoing Channel)`
6. `## Decision Policy Contract`
7. `## Command Write Path (Incoming Channel)`
8. `## Multi-Skill Composition` (optional additional skills and precedence)
9. `## Guardrails` (debounce, cooldown, duplicate suppression)
10. `## Validation and Test Plan`
11. `## Failure Modes and Recovery`
12. `## Common Errors`

Do not remove any section. If one does not apply, state why.

## Quality Gates Before Writing Final File

All gates must pass:

- No unresolved `UNVERIFIED` facts that are required for implementation.
- No fake/mock telemetry in real-device flows unless user explicitly requests simulation.
- Topic and payload schemas are explicit and consistent across examples.
- Commands and file paths are runnable on the target runtime.
- Clear distinction between required user input and optional tuning.
- Validation plan can prove success end-to-end.
- The two generated skills are role-separated (bridge vs policy), not merged.

If any gate fails, do not generate the final skill file. Return missing items and next actions.

## Required Final Response Pattern

When done, respond in this format:

1. `Discovery summary` (facts gathered)
2. `Validation status` (passed/blocked with reasons)
3. `Two-skill design summary` (bridge role, policy role, shared topics)
4. `Multi-skill composition plan` (for the smart agent)
5. `Generated files` (exact file paths)
6. `Open risks` (if any)

## Anti-Patterns

Never do the following:

- Generate a full skill from a guessed device model.
- Treat protocol assumptions as facts.
- Skip command-channel behavior for an actuator device.
- Mix simulated and real data without explicit labeling.
- Omit verification commands and expected output shape.
- Merge bridge and policy behavior into one skill unless explicitly requested.

## Quick Start Prompt (for agent use)

Use this when invoking the workflow:

```text
Create a SmartClaws two-skill bundle for <DEVICE_MODEL>.
Generate:
1) a simple bridge skill (<device>-publisher), and
2) a smart controller skill (<device>-reader).
Follow a research-first process: discovery, validation, design, then generation.
Do not generate final SKILL.md files until all required inputs are verified.
Return discovery notes, validation table, composition plan, and then write both skills.
```
