# SmartClaws Vodafone Demo Roadmap

Companion to [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md). That file describes
*what exists today*; this file describes *where we are going* and *how we get
there*. Action items live in [CHECKLIST.md](CHECKLIST.md).

## North Star

Build a framework where the only scenario-specific artifacts are skill
bundles. At the end, swapping demo scenarios — heat pump, EV charger,
anything else — is a matter of dropping in a new device skill and a new
master-agent skill. Nothing else changes.

A live Vodafone demo on top of that framework where:

- A "primitive" device-agent reads telemetry and publishes it on-chain
  through a reusable **device skill** that ties one skill to one device.
- A "master" agent reads channels, runs a decision policy declared in a
  **master-agent skill**, and publishes commands to device incoming
  channels.
- A minimal viewing surface (CLI tail and/or dashboard) shows what is
  happening end-to-end.
- The blockchain is a Kafka-like append-only log. Contracts only enforce
  *who can publish to which channel*. Schema, semantics, topics, and
  orchestration all live off-chain in the envelope and in skills.

## Architectural Principles

These are load-bearing. If a feature requires breaking one, that is a signal
to redesign.

1. **Channels are partitions.** One channel is an append-only log. Filtering
   and fan-out happen off-chain by reading the envelope's `topic` and `dev`
   fields.
2. **Contracts only gate writes.** The on-chain publisher ACL on a channel is
   the only authorization layer. No on-chain schema validation, no on-chain
   business logic.
3. **Schema lives in the envelope and the skill.** The
   [envelope](packages/core/src/envelope.ts) format is the contract between
   producer and consumer. Skills document what topics a device emits and
   accepts.
4. **Skills are the unit of behavior; scenarios are skill bundles.** A device
   skill describes one device class. A master-agent skill describes one
   decision policy. Switching demo scenarios is *only* swapping skill
   bundles. The framework, runtime, CLI, and dashboard never know which
   scenario is loaded — if they do, that is a bug.
5. **Agents stay dumb where possible.** Device agents are mechanical: read,
   encode, publish, read incoming, actuate. Only the master agent has policy
   logic.
6. **Reads are public, writes are owned.** Anyone can subscribe; only the
   authorized publisher can write.
7. **Build only what blocks the next milestone.** No premature UI, no
   premature CLI, no anticipatory abstractions. A working CLI tail is
   acceptable until it isn't. Resist building enablers that have no caller.

## Skill Templates

Two template families to design and maintain.

### Device skill template

One skill per *device class*, parametrized per *device instance*. Each skill
declares:

- Hardware/source: how to acquire raw telemetry (BLE characteristic, modbus
  register, HTTP API, simulator clock, etc.).
- Outgoing topics: list of `{topic, payload schema, cadence}`.
- Incoming topics (optional): list of `{topic, payload schema, handler}` —
  what commands the device accepts and how it actuates them.
- Lifecycle: init, run loop, shutdown.
- Config surface: what the operator must provide (BLE address, calibration
  offsets, simulator parameters, etc.).

The existing [smartclaws-producer skill](skills/smartclaws-producer/SKILL.md)
becomes the *meta-skill* that teaches an AI agent how to instantiate a
device skill from this template.

### Master-agent skill template

One skill per *decision policy*. Each skill declares:

- Inputs: which channels/topics to subscribe to and how to align them.
- Decision function: pure-ish function from observation window to commands.
- Outputs: which device incoming channels to publish to, with what topics.
- Decision log: every decision is also published to the agent's *own*
  outgoing channel for auditability — this is what any UI renders.
- Cadence: tick interval, debouncing, cooldowns.

## Milestones

Framework-first. Nothing scenario-specific lands until M5.

### M0 — Direction set

Resolved in design conversation:

- Framework-first commitment: build the abstraction, defer the demo device.
- Demo will be single-actuator-device, with scale-to-multi-device as a
  later goal.
- LYWSD03 BLE temperature sensor stays the only real-hardware piece in
  the demo room.

### M1 — Truly blocking unblockers

Only items that genuinely block M2/M3.

- CLI command (or core library function) for reading a device's *incoming*
  channel. Devices have incoming channels on-chain but no read path in the
  CLI today (gap noted in [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md)) —
  required for any device skill that actuates on commands.
- Channel-as-partition + envelope-as-schema convention written down inside
  the [core package](packages/core), so the skill spec has something to
  reference.

Deferred (used to be in this milestone, but no current caller blocks on them):

- `smartclaws read --channel` working without a wallet file.
- Bun lockfile policy.

### M2 — Device skill template + placeholder device

- Specify the device skill template: folder layout, manifest fields,
  lifecycle hooks, declared in/out topics.
- Reference impl: a deliberately boring placeholder (`counter-sim` or
  similar) that emits an integer on a clock and accepts a setpoint. The
  point is to validate the abstraction, not to be interesting.
- Validate the spec by retro-fitting the LYWSD03 BLE flow into the same
  shape. If real hardware doesn't fit cleanly, the spec is wrong, not the
  hardware.

### M3 — Master-agent skill template + placeholder policy

- Specify the master-agent skill template: input subscriptions, decision
  function signature, output topics, decision-log emission.
- Add `smartclaws agent register / publish / read` CLI commands so the
  master agent has its own on-chain identity and decision-log channel.
- Reference impl: a placeholder policy (e.g. `target-tracker`) that reads
  one or two channels and emits a setpoint to track a target. Boring on
  purpose. Validates the runtime end-to-end.

### M4 — Minimum viewing surface

Just enough for someone to see what is happening end-to-end. Build only
what is missing for that goal — full dashboard polish is M6 territory or
later.

Likely sufficient:

- CLI tail for live channel viewing.
- Dashboard agent detail page that decodes the agent's outgoing channel
  using the same envelope decoder the channel viewer already uses.
- Whatever generic payload-table improvements are needed in the channel
  viewer to render arbitrary topics without hard-coded schemas.

Explicitly *not* in this milestone:

- Scenario-specific charts.
- Demo-mode layouts.
- Visual polish.

### M5 — Scenario instantiation (the demo)

This is the first milestone where the demo becomes recognizable.

- Pick the device: EV charger or heat pump. Decision deferred until here
  on purpose; see [Candidate scenarios](#candidate-scenarios-for-m5).
- Ship *only* skill bundles: one device skill, one master-agent skill,
  optionally a sim helper for non-real inputs (e.g. price feed).
- If anything outside the skill bundles needs to change to make the demo
  work, stop and fix the framework instead.

### M6 — Demo hardening

- Fast-forward / replay so the demo doesn't hinge on real wall-clock
  pricing ticks.
- Resilience to RPC blips during a live presentation.
- Whatever scenario-aware visual polish the demo benefits from.
- Runbook + rollback plan for the live presentation.
- Pin a Bun lockfile if reproducibility has bitten by now.

## Candidate Scenarios for M5

Both fit the framework. Decision deferred until M5.

**EV charger.** Simpler to model. Single binary-ish actuator (charge or
not, plus current limit), clean savings story (kWh × price differential).
Risks: residential smart-chargers already do basic off-peak scheduling, so
the demo policy needs a non-commodity twist — dynamic re-planning when
price forecast changes, plus a grid/curtailment signal channel that
forces re-optimization. 100% on-screen simulation; no physical feedback
loop.

**Heat pump / AC.** Richer narrative (comfort vs cost tradeoff, pre-heat
into cheap windows). Closes a real physical loop with the LYWSD03 — the
sensor reports actual room temperature, the simulated heat pump's effect
on the sim feeds back into the displayed temperature trace. Harder to
simulate convincingly (thermal model of the room).

The framework should make either viable as a few days of skill-bundle
work at M5. If it isn't, the framework leaked scenario assumptions
earlier.

## Cross-cutting Concerns

- **Topic conventions.** A small, documented set of topic strings so
  device and master-agent skills agree (e.g. `telemetry.*`, `command.*`,
  `decision.*`). Belongs in the core package, seeded in M1.
- **Envelope evolution.** The current `v: 1` envelope has no schema id
  beyond `topic`. Before many skills accumulate, decide whether `topic`
  carries schema identity or whether to add an explicit `schema` field.
- **Read fan-out at scale.** Polling every channel from the dashboard
  and the master agent will not scale. Fine for the demo; flag as
  known-limitation rather than silently set expectations.
- **Security framing.** Plaintext private keys in `~/.smartclaws/wallets`
  are fine for a demo but must be called out, not hidden, if Vodafone
  asks about production posture.

## Out of Scope (explicitly, for now)

- On-chain agent reputation, payments, or staking.
- Cross-chain or multi-registry federation.
- A real Python SDK (the Python side stays scripts-only for the demo).
- Dashboard write flows beyond what the demo scenario strictly needs.
- Multi-device-site orchestration. Single actuator first; scale is post-demo.

Anything in this section can be revisited *after* the Vodafone demo lands.
