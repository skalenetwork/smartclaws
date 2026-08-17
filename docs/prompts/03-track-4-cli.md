# Track 4 — CLI

**Blocked on Track 3C.** Runs in parallel with Track 5 (plugin) — they share no files.
**Read [`00-DEPLOYMENT.md`](./00-DEPLOYMENT.md) first** — shared addresses, rules and gates. Spec: roadmap "Track 4", propagation §4.

## Files you own

```
packages/cli/src/commands/publish.ts, read.ts, device.ts, agent.ts, init.ts,
                          discover.ts, whoami.ts, key.ts (new)
packages/cli/src/index.ts
packages/cli/tests/**
```

Read-only: all of `packages/sdk`, `packages/core`, `packages/openclaw-plugin` (Track 5 owns it),
`packages/dashboard`.

## Commands

- `device register --encrypted`, `agent register --encrypted`
- `device reader add|remove|list --channel incoming|outgoing`, same for `agent`
- `key register|show|remove` (new `key.ts`) against `PublicKeyRegistry`
- `init --bite-rpc-url`, and `init --encrypted` applying to entities created in that invocation
- `publish --wait` / `--no-wait`, **waiting by default**
- `read --disclose`, with `--decrypt` as an optional alias

## Behaviour that must not regress

- **Plain flows unchanged, sending exactly zero value.** Plain channels revert on any non-zero
  `msg.value`.
- **Encrypted `--no-wait` output must say `Scheduled`, never `Published`.** This is the single most
  important line of output in the whole track: origin success is not storage, and a user who reads
  "Published" for a message that was later dropped has been actively misled.
- JSON output must stringify bigint fee fields.
- `whoami` reports reader status only for attached or cached channels. There is no global reader
  membership index and you must not invent one by scanning.
- `read` defaults to the **free** labelled-ciphertext view. Disclosure happens only behind the
  explicit flag, and the command must say what it will cost before spending.
- `--limit` on disclosure caps at 10 per request. Do not silently issue several paid transactions.

## The init sequencing trap

Registering a public key is a **transaction**, so it requires a funded wallet — but `init`
completes before the wallet has any balance. Do not auto-register a key for a fresh wallet. Present
`smartclaws key register` as a post-funding step in the guidance output instead.

## Legacy registries

Existing users' configs still point at the old registry, which has no `publicKeyRegistry()` and no
encrypted device getters. Track 3B added detection and typed errors for this. Surface those as
clear, actionable CLI messages — tell the user their registry predates encrypted channels and what
to do — not as raw reverts or stack traces.

## Testing

Extend both `tests/unit/` and `tests/integration/`. Integration needs anvil; it is stateful, so
`docker rm -f anvil; bash scripts/anvil.sh` before believing a failure.

Live channels from `00-DEPLOYMENT.md` are free to read. **Do not spend funds without asking the
operator** — publishing or disclosing on the live deployment costs real sFUEL. If you want a live
run, stop and ask, stating the cost and target.

## Report

Files changed, the exact output strings for encrypted publish in both wait modes, how legacy
registries are surfaced, and gate results verbatim.
