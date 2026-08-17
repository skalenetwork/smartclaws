# Track 5 — OpenClaw plugin

> **LANDED 2026-08-17.** Kept as the specification of what was built, not as work to do.
> One amendment since: reader status was specified as part of `smartclaws_wallet_info`, which
> made an O(1) identity question walk every locally known entity. It lives in a separate
> `smartclaws_access_check` tool; `wallet_info` keeps wallet-scoped facts and reports whether
> the registered key is the one the wallet can decrypt with.

**Blocked on Track 3C.** Runs in parallel with Track 4 (CLI) — they share no files.
**Read [`00-DEPLOYMENT.md`](./00-DEPLOYMENT.md) first** — shared addresses, rules and gates. Spec: roadmap "Track 5", propagation §5.

## Files you own

```
packages/openclaw-plugin/**   (src, manifest, package.json, README, tests)
```

Read-only: everything else, especially `packages/cli` (Track 4 owns it) and all of `packages/sdk`.

## The core design decision — do not fold disclosure into read

`smartclaws_read` stays **free, wallet-free and non-optional**. It returns labelled ciphertext
metadata for encrypted channels.

Add disclosure as a **separate optional tool** (`smartclaws_disclose`) that signs, pays, waits and
decrypts. Do not add a `decrypt: true` flag to `smartclaws_read` — that would turn a read-only tool
that agents are expected to allowlist unconditionally into one that spends money, which breaks the
entire allowlist model the skills teach. Mark the new tool `optional: true` in the manifest.

## Tool changes

- `smartclaws_read` — labelled ciphertext for encrypted channels: `encrypted`, `ciphertextBytes`,
  raw hex. Never a decode error; reading ciphertext is a successful read.
- `smartclaws_disclose` (new, optional) — the paid two-phase read. Enforce the 1–10 batch limit and
  verify reader authorization and public-key registration **before** spending.
- `smartclaws_publish` / `smartclaws_notify` — auto-detect kind, wait by default, and return the
  `PublishState` from 3C along with fee and CTX hash.
  **A returned object must never be readable by an agent as "published" when it was only
  scheduled.** A timeout stays `scheduled`/`unknown` and is never rewritten as success — an agent
  that believes a dropped command succeeded will act on a world state that does not exist.
- `smartclaws_wallet_info` — add public-key readiness and reader status for known channels, so an
  agent can self-diagnose why a disclosure failed instead of retrying blindly.
- `plugin-config.ts` — no new endpoint field. Every SKALE node serves the `bite_*` methods, so
  there is no separate BITE RPC and `Config.biteRpcUrl` was removed; the existing RPC URL is used.

## Manifest and versioning

Bump plugin `0.2.0` → `0.3.0` and keep the manifest and `package.json` versions **equal** —
`bun run plugin:manifest:check` enforces this in CI. Update the `contracts.tools` list and the
README tool table. Note `.github/copilot-instructions.md` still describes four tools; it is outside
your ownership, so report it rather than editing it.

## Testing

Extend `tests/unit/publish.test.ts` and `notify.test.ts` and add coverage for the new tool and the
changed result shapes. Use the injectable encryption fake from Track 3A.

`BITEMockup` is **not** a confidentiality oracle — never write a test that claims to prove
confidentiality or AAD interoperability against a mock.

Live channels from `00-DEPLOYMENT.md` are free to read. **Do not spend funds without asking the
operator first**, stating cost and target channel.

## Report

Files changed, the exact returned object for an encrypted publish in each `PublishState`, the
manifest/package version pair, and gate results verbatim — including
`bun run plugin:manifest:check` and `bun run plugin:validate`.
