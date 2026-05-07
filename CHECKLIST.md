# SmartClaws Demo Checklist

Living action list for the Vodafone demo. Pair with [ROADMAP.md](ROADMAP.md)
for the why and the milestone structure.

Conventions:
- `[ ]` not started, `[~]` in progress, `[x]` done.
- Add a one-line note under an item when you finish it (date + what changed)
  so future-you has a trail.
- Keep this file short. When something is done and stale, delete it instead
  of leaving a graveyard.

## Now (next 2-3 things)

- [x] **Lock framework-first direction.** Resolved 2026-05-05: build the
  abstraction and runtime first against a placeholder device; the demo
  device (EV charger or heat pump) is a late-binding skill-swap at M5.
  Single actuator for the first demo, scale-to-multi-device is post-demo.

- [ ] **Draft the device skill template spec.** Short markdown spec:
  folder layout, manifest fields, lifecycle hooks, declared in/out topics,
  config surface. Validate by retro-fitting the existing LYWSD03 BLE flow
  into the shape — if real hardware doesn't fit cleanly, the spec is
  wrong, not the flow. No scenario-specific names anywhere in the spec.

- [ ] **Build a placeholder device against the spec.** Something
  deliberately boring (e.g. `counter-sim` — emits an integer on a clock,
  accepts a setpoint). Forces us to add the missing CLI path for
  subscribing to a device's *incoming* channel, which is the one
  framework-blocking gap from
  [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md). When this round-trips
  end-to-end against Anvil, M2 is done.

## Later

Move items here from the roadmap as they become the next concrete step.
Keep this section under ~5 items so the file stays useful.
