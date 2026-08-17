# Track 3B — SDK contracts, discovery, registration and readers

> **SUPERSEDED — implemented, then amended.** 3B was completed, and a follow-up pass is removing
> the backward-compatibility work described in section 1 below: pre-encryption registries are no
> longer supported, `Config.biteRpcUrl` is gone, and `encrypted` became a required field. This file
> is kept as the record of what the track originally asked for. **Do not implement it as written.**

**Read [`00-DEPLOYMENT.md`](./00-DEPLOYMENT.md) first** — shared addresses, rules and gates.

Spec: roadmap "Track 3B", propagation §3 (`contracts.ts` / `discovery.ts` sections).

## Files you own

```
packages/sdk/src/contracts.ts
packages/sdk/src/services/discovery.ts
packages/sdk/src/services/readers.ts        (new)
packages/sdk/src/index.ts
packages/sdk/tests/unit/discovery.test.ts
packages/sdk/tests/unit/readers.test.ts     (new)
```

Read-only: everything else. In particular `services/encryption.ts`, `ctx.ts` and `keys.ts` are
finished (Track 3A) — consume them, do not modify them. `services/channels.ts` belongs to 3C.

## 1. The legacy-registry problem — do this first, it is the reason this track is urgent

`packages/sdk/src/config.ts` preserves the user's existing `registryAddress` across migration, and
that is correct: silently repointing someone at a new deployment is worse than a clear error. But
the deployed registry at `0x2A49ADe245fE42E6C3eBC7972bB0Fe324fc923b5` predates all encrypted work.
Its `SmartClaws` has **no `publicKeyRegistry()`** and its device groups have **no
`getEncryptedDevices()` / `getEncryptedDeviceCount()`**.

So a preserved config plus your new code reverts on *ordinary plain discovery* — a total
regression for every existing user, not just encrypted ones. There is a `TODO(legacy-registry):`
marker at the migration site.

Resolve it explicitly. Detect a legacy registry once, memoize it, and degrade: legacy registries
report zero encrypted devices and surface a clear typed error (not a raw revert) when something
genuinely requires `publicKeyRegistry()`. Do **not** paper over it with a blanket try/catch around
every call — that would also swallow real failures. Decide deliberately whether detection is by
probing a method or by comparing against the known legacy address, and write down why in a comment.

Test both: a legacy registry still lists plain devices and reports zero encrypted; the new registry
lists both.

## 2. Contracts and memoization

- Add encrypted-channel and `PublicKeyRegistry` clients. Note channels now need **write** contracts
  (`requestMessages`, `addReader`), where only a read client existed before.
- Resolve `publicKeyRegistry()` from `SmartClaws` and memoize it in-process. Do not persist a
  second address in config that could disagree with the selected registry.
- Memoize channel kind. It is immutable per channel address, so caching is safe for the session.

## 3. Discovery

- Query the plain and encrypted device sets **in parallel** and merge them, deduplicated, into the
  canonical `GroupFile.devices` with the per-kind breakdown fields Track 2 added. `deviceCount` is
  the total across both, not the plain-only count it used to be.
- Carry the known kind down from discovery into hydration — an entity found via
  `getEncryptedDevices()` needs no `isEncrypted()` call. Only query when hydrating an address with
  no provenance.
- **An absent cached `encrypted` flag means unknown, never plain.** Query it. Defaulting to plain
  publishes plaintext framing to an encrypted channel, which is the worst outcome in this project.
- Query reader membership only for encrypted channels; it is meaningless on plain ones.

## 4. Registration and readers

- Opt-in encrypted device/agent/channel registration routing to `registerEncryptedDevice`,
  `registerEncryptedAgent`, `createEncryptedChannel`.
- These paths already decode the receipt, so take the `encrypted` flag from the indexed event —
  no extra `isEncrypted()` call. **Assert the event's flag matches what was requested** and fail
  loudly if not; a mismatch means you registered a different kind than the caller asked for.
- New `services/readers.ts`: grant/revoke/list for device and agent targets with an
  `"incoming" | "outgoing"` selector, plus a direct-channel variant. `deviceRoleIds` /
  `agentRoleIds` stay as they are — reader status gets its own accessor.
- The device group now has owner-gated `addIncomingReader` / `removeIncomingReader` /
  `addOutgoingReader` / `removeOutgoingReader` passthroughs for group-administered devices. Use
  them when the group is the device admin.

## 5. Wire up Track 3A

`services/encryption.ts`, `ctx.ts` and `keys.ts` are deliberately unexported and take explicit
primitives rather than a `Config` — that was to let parallel work proceed without file collisions.
Export them from `index.ts` and add the `Config`-based construction path using the existing
`resolveBiteRpcUrl(config)` helper (`biteRpcUrl || rpcUrl`). Keep the explicit-parameter functions
intact; add a convenience layer, do not replace the testable core.

## Verify against the live deployment

Beyond unit tests, run a real read-only script against the addresses in `00-DEPLOYMENT.md` and
paste the output in your report. At minimum: the mixed group returns 1 plain + 1 encrypted device
and a merged count of 2; `isEncrypted()` is true for the encrypted channel and false for the plain
one; `publicKeyRegistry()` resolves on the new registry and fails cleanly on the legacy one.

No wallet, no spending — these are all view calls.

## Report

Files changed, how legacy detection works and why you chose that method, live-verification output,
and gate results verbatim.
