# Encrypted-channels track prompts

Self-contained briefs for the remaining encrypted-channels work. Each is written to be handed to
a fresh coding session that has no prior context.

Start a session with, for example:

> Read `docs/prompts/00-DEPLOYMENT.md` and implement `docs/prompts/01-track-3B.md`.

| Prompt | Track | Status |
|---|---|---|
| [`00-DEPLOYMENT.md`](./00-DEPLOYMENT.md) | Shared context — live addresses, invariants, gates | read first, always |
| [`01-track-3B.md`](./01-track-3B.md) | SDK contracts, discovery, registration, readers | **ready** |
| [`02-track-3C.md`](./02-track-3C.md) | Publish and disclosure | blocked on 3B |
| [`03-track-4-cli.md`](./03-track-4-cli.md) | CLI | blocked on 3C |
| [`04-track-5-plugin.md`](./04-track-5-plugin.md) | OpenClaw plugin | blocked on 3C |

Tracks 4 and 5 share no files and run in parallel once 3C lands.

Progress, ordering and open corrections live in
[`../encrypted-channels-implementation-roadmap.md`](../encrypted-channels-implementation-roadmap.md);
the wire contract lives in
[`../encrypted-channels-propagation.md`](../encrypted-channels-propagation.md).
