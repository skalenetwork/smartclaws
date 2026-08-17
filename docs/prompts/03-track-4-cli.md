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
- `device reader add|remove|list --side incoming|outgoing`, same for `agent`
- `key register|show|remove` (new `key.ts`) against `PublicKeyRegistry`
- `init --encrypted`, applying to entities created in that invocation. There is **no**
  `--bite-rpc-url`: every SKALE node serves the `bite_*` methods, so a separate BITE endpoint does
  not exist and `Config.biteRpcUrl` was removed.
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

## No legacy support

Pre-encryption registries are not supported and there is no compatibility path. Do not add
detection, fallbacks, or degraded modes. Likewise, a pre-v3 config file is not migrated — it must
fail with a clear "re-run `smartclaws init`" message rather than being silently repaired.

## Testing

Extend both `tests/unit/` and `tests/integration/`. Integration needs anvil; it is stateful, so
`docker rm -f anvil; bash scripts/anvil.sh` before believing a failure.

Live channels from `00-DEPLOYMENT.md` are free to read. **Do not spend funds without asking the
operator** — publishing or disclosing on the live deployment costs real sFUEL. If you want a live
run, stop and ask, stating the cost and target.

## Addendum — RESOLVED after the track landed

Recorded because the conventions below are now load-bearing, and re-litigating them would
churn the CLI surface users have been given.

**Two flag words, one meaning each.** `--channel` is *always* a channel address.
`--side incoming|outgoing` is *always* one half of an entity's channel pair. The reader
subcommands originally spelled the side `--channel`, which collided with `--channel <address>`
in `read` and `publish`; they were renamed to `--side`. Do not reintroduce a second meaning
for either word.

`publish --device-channel telemetry|command` deliberately stays as it is. There the choice is
not merely which channel but which contract method, and those enforce different roles
(`PUBLISHER_ROLE` vs `MASTER_ROLE`), so the action names carry more information than
`incoming`/`outgoing` would.

**Every entity channel is reachable by name.** `read` and `publish` take
`--device <address-or-name>` or `--agent <address-or-name>` or `--channel <address>` — exactly
one — and `read` takes `--side`. Previously only a device's outgoing channel could be named,
which mattered most for encrypted channels: commands sitting on an encrypted incoming channel
are ciphertext, so disclosure is the only way to read them, and disclosure was precisely the
path that could not name that channel.

`--side` with `--channel` is rejected rather than ignored. An address already names one
channel, so accepting and dropping a side would read a different channel than the one asked
for, silently.

`read` prints the entity and side it read, so `--device d` and `--device d --side incoming`
are distinguishable in both human and JSON output.

**Read the parsed option, not `process.argv`.** `publish` briefly decided `wait` with
`!process.argv.includes("--no-wait")`, which left `--wait` declared but dead and made the
flag→status wiring impossible to drive in-process. `opts.wait ?? true` is correct: commander
leaves it `undefined` by default and `false` for `--no-wait`.

## Report

Files changed, the exact output strings for encrypted publish in both wait modes, and gate
results verbatim.
