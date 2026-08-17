# Encrypted Channels — Propagation Pre-Plan

Scope: everything **outside** `smart-contracts/` that must change now that
`SmartClawsChannelEncrypted` + `PublicKeyRegistry` exist (commit `830bb04` and the
unstaged working tree). This is a *survey of the surface*, not an implementation plan —
each item says **what** is affected and **what has to change**, not the order or the diff.

`open-claw-setups/` is deliberately excluded. `python/` is a stale experimental stub
(`python/src/smartclaws/cli/main.py` is 10 lines) — no action assumed.

> **Already applied since the first draft of this document:**
> §11.1 (encrypted flag on the registration events), §11.2 (group reader passthroughs), and
> §1 (ABI/artifact plumbing — all seven ABIs exported and committed, with a CI drift check)
> are implemented. §11.4 is resolved as a decision, not a change: the split device sets stay.
> The stale four-argument deploy in `packages/cli/tests/setup.ts` (§9) is fixed, so the
> integration lane is green against the regenerated ABIs.
>
> Also landed since: §2 (core types + Config v3), the encryption/CTX/keys half of §3,
> §6 in observer-only form, and §11.3 (`deploy.ts` now creates and verifies encrypted samples,
> though it has not yet been run against SKALE).
>
> Still outstanding: §3's contracts/discovery/readers and publish/disclosure work, §4 (CLI),
> §5 (plugin), §7 (skills), §8 (dev scripts), and §10 (docs).
>
> See the roadmap's Status section for ordering, the open legacy-registry contradiction, and
> the live-chain facts that cannot be re-derived locally.

---

## 0. The wire contract everything else derives from

Every downstream decision follows from these facts. Getting one wrong silently breaks
confidentiality or truthfulness, so they're stated once here and referenced throughout.

### Detection

Two discriminators, and which one applies depends on where you are:

- **From a registration receipt or from logs** — the `encrypted` flag on `ChannelCreated`,
  `AgentRegistered`, and `DeviceRegistered` (§11.1, now implemented). It is `indexed`, so
  an indexer or the dashboard can filter plain vs encrypted by topic with no contract call
  at all. This is the path for `registerDevice` / `registerAgent` (which already decode the
  receipt) and for anything log-driven.
- **From an address you were handed** — `isEncrypted()` on `ISmartClawsChannel`, which
  **both** implementations answer. This is the only option when hydrating an entity you
  discovered through `getDevices()` / `getAgents()` rather than through an event.

Invariant worth relying on: a device/agent's two channels always come from the *same*
factory ([SmartClawsDevice.sol:67-68](../smart-contracts/contracts/SmartClawsDevice.sol#L67-L68)),
so one `encrypted` flag per device/agent is sufficient — no per-channel flag needed.

### Publish (write path)

1. Plaintext framing: `abi.encode(address publisherWallet, bytes envelope)`.
2. Ciphertext: `bite.encryptMessageForCTX(plaintextHex, CHANNEL_ADDRESS)`.
   **aadTE is the channel address, never the device/agent address** — the channel is what
   calls `submitCTX`. This is the single easiest thing to get wrong, because on the device
   path the caller never otherwise needs the channel address.
3. The bound address is the **wallet**, on both paths:
   - direct: `publishMessage` → `_requestPublish(payload, msg.sender, msg.sender, msg.sender)`
   - mediated: device/agent calls `publishMessageFor(payload, msg.sender)` →
     `authorizedPublisher = device contract`, `encryptedPublisher = wallet`
     ([SmartClawsChannelEncrypted.sol:159-165](../smart-contracts/contracts/SmartClawsChannelEncrypted.sol#L159-L165)).
4. Fee: `value >= getPublishCallbackGas(ciphertextByteLen) * tx.gasprice`
   (`150_000 + 800/byte`). The client **must send the same `gasPrice` it used to compute
   the value** — viem's default estimation will not match unless set explicitly.
5. Entry points are unchanged (`publishTelemetry`, `publishCommand`, `publishOutbound`,
   `publishInbound`, `publishMessage`) — they are already `payable`.
6. **Scheduled ≠ stored.** The origin tx emits `DeviceTelemetryScheduled` /
   `AgentOutboundScheduled` / etc. The message is only appended in a *later CTX
   transaction*, which emits `MessagePublished(channel, offset)`. Confirmation requires
   `bite_getCraftedCtxs` → wait for the CTX receipt.
7. The CTX callback can revert (publisher revoked between submit and callback, channel
   paused/disabled, capacity) — the message is **dropped with no retry path and no refund**
   for that submitter (documented as accepted in `smart-contracts/README.md`).
8. Plain channels **reject** `msg.value != 0` (`NativeValueNotAccepted`,
   [SmartClawsChannel.sol:119](../smart-contracts/contracts/SmartClawsChannel.sol#L119)) —
   so value must be exactly 0 on the plain path. One code path cannot serve both blindly.

### Read (disclosure path)

1. `readMessage` / `readMessages` still work on encrypted channels and return the **stored
   TE ciphertext**. Today's `decode()` will throw → every message surfaces as
   `decodeError: true`. That is a display/label problem, not an error.
2. Real reads are two-phase and cost a transaction:
   - one-time: register the wallet's secp256k1 public key with `PublicKeyRegistry`
     (address via `registry.publicKeyRegistry()`), validated on-curve.
   - one-time: be added as a reader by the channel owner — `channel.addReader` (owner),
     `device.addIncomingReader/addOutgoingReader` (DEVICE_ADMIN_ROLE),
     `agent.addIncomingReader/addOutgoingReader` (registry/owner/AGENT_ADMIN).
   - per read: `requestMessages(fromOffset, count){value}`, `count <= MAX_READ_BATCH (10)`,
     fee = `getReadCallbackGas(sum of stored ciphertext lengths, count) * tx.gasprice`.
     The sizes come from the plain `readMessages` view — so a disclosure read is
     *view-read → compute fee → sign → wait CTX → decrypt*.
   - the CTX tx emits `MessageDisclosed(channel, reader, offset, encryptedPayload)`.
   - decrypt locally: `IV(16) ‖ ephemeralPubKey(33) ‖ ciphertext`, key = `SHA-256(ECDH)`,
     AES-256-CBC. Plaintext is the **raw envelope bytes** (the contract unwraps the
     `abi.encode(bytes)` layer before ECIES), so it feeds `decode()` directly.
3. Decryption needs the **private key**. This is the hard constraint on the dashboard (§6).

### Reader ACL is not an AccessControl role

Readers live in an `EnumerableSet` on the *channel* (`addReader`/`isAuthorizedReader`/
`getReaders`), not in the device/agent role system. Anything that enumerates permissions
(`deviceRoleIds`, `agentRoleIds`, the dashboard access matrix) needs a second query
dimension, not a new role constant.

---

## 1. ABI / artifact plumbing — do this first, everything reads from it

| File | Change |
|---|---|
| `smart-contracts/scripts/export-abi.sh:8` | `CONTRACTS=(...)` is a hardcoded list. Add `SmartClawsChannelEncrypted` and `PublicKeyRegistry`. Without this the new ABIs never reach `packages/core/abi/`. |
| `packages/core/abi/*.json` | All five existing ABIs are stale: `SmartClaws` (2 new ctor args, `createEncryptedChannel`, `registerEncryptedAgent`, `publicKeyRegistry()`, `publicKeyRegistryFactory()`, **changed `ChannelCreated` / `AgentRegistered` signatures**), `SmartClawsDeviceGroup` (`registerEncryptedDevice`, `getEncryptedDevices`×2, `getEncryptedDeviceCount`, new ctor arg, **changed `DeviceRegistered` signature**), `SmartClawsDevice` / `SmartClawsAgent` (reader fns, `payable` publishes, `*Scheduled` events), `SmartClawsChannel` (`isEncrypted`, `payable`, `NativeValueNotAccepted`). |
| `packages/core/package.json` | `./abi/*` is a wildcard export — no change needed. |

CI (`.github/workflows/typescript.yml`) already runs compile + export-abi, so it picks this
up automatically once the script list is fixed.

---

## 2. `packages/core`

**`src/types.ts`**
- `DeviceFile`, `AgentFile`: add `encrypted?: boolean` (or `channelKind: "plain" | "encrypted"`).
  Without a cached flag, every publish costs an extra `isEncrypted()` RPC round-trip.
  Decision needed (§12.5): cache vs always-query.
- `GroupFile`: `devices` / `deviceCount` now only cover the plain set. Add
  `encryptedDevices: string[]` and `encryptedDeviceCount: number`, or merge both sets and
  keep a per-device flag. **Today's SDK simply cannot see encrypted devices** (§3).
- `EntityCapabilities`: add `isIncomingReader?`, `isOutgoingReader?`, and `hasPublicKey?`.
- `Config`: candidate new fields — `biteRpcUrl?` (§12.1), `publicKeyRegistryAddress?`
  (cacheable, avoids a lookup). If fields are added, bump `version: 2 → 3` and extend
  `migrateConfig` in the SDK (the v1→v2 path is already there as a model).

**`src/networks.ts:19`** — `registryAddress` is a live deployed address. The `SmartClaws`
constructor changed arity, so the current deployment is unusable with the new code; a
redeploy is mandatory and this constant must be updated (and the dashboard's
`VITE_REGISTRY_ADDRESS`, and any `SMARTCLAWS.md` in the wild).

**`src/envelope.ts`** — unchanged. The envelope is the ECIES plaintext, so `v: 1` framing
carries through untouched. Worth stating explicitly in docs so nobody "adds encryption" here.

**New module?** The ECIES decrypt helper and the `abi.encode(address, bytes)` framing need
a home. Recommend the SDK, not core — core is currently dependency-free (no viem, no node
crypto) and that is worth preserving.

---

## 3. `packages/sdk` — the largest surface

**Dependencies**: add `@skalenetwork/bite`. Strongly consider `@skalenetwork/privacy-sdk`
(viem-native, ships `getCtxHashes` / `waitForCtx` / `createCtxPromise`) instead of
hand-rolling `bite_getCraftedCtxs` — the SDK is already viem-based (§12.7).

**New `src/services/encryption.ts`** (or `bite.ts`) — the whole new primitive layer:
- BITE client construction from `Config`.
- `encryptForChannel(envelopeBytes, publisherAddress, channelAddress)` — the §0 framing.
- `computePublishFee(channelAddress, ciphertextLen, gasPrice)` / `computeReadFee(...)`.
- `waitForPublish(txHash)` → CTX hashes → CTX receipt → parse `MessagePublished` → offset.
- `registerPublicKey(config, wallet)` / `hasPublicKey(address)` / `getPublicKey(address)`.
- `requestDisclosure(...)`, `waitForDisclosure(...)` (parse `MessageDisclosed`),
  `eciesDecrypt(privateKey, encryptedHex)`.

**`src/contracts.ts`** — add `getEncryptedChannelContract` (read + write; note channels now
need *write* contracts for `requestMessages`/`addReader`, previously only
`getChannelContract` existed), `getPublicKeyRegistryContract`, and a memoized
channel-kind resolver.

**`src/services/channels.ts`** — all six exported functions branch:
- `readMessages` (line 96): plain path unchanged; encrypted path returns ciphertext
  metadata by default and must **label** it (`encrypted: true`, `ciphertext: true`) rather
  than reporting `decodeError`. A `disclose` mode does the full 2-phase read. `limit`
  semantics change (≤10 per CTX; larger limits = multiple CTXs = multiple fees).
- `publishChannelMessage`, `publishDeviceTelemetry`, `publishDeviceCommand`,
  `publishAgentOutbound`, `publishAgentInbound`: encrypt → fee → `value` + explicit
  `gasPrice` → optionally wait for the CTX.
- `PublishResult` shape: `status: "success"` currently means "origin tx mined". On the
  encrypted path that is **not** "message stored". Add `encrypted`, `scheduled`, `ctxHash`,
  `confirmedOffset`. Every consumer (CLI output, plugin return value, skill wording) hangs
  off this — it's the main truthfulness risk in the whole change.

**`src/services/discovery.ts`**
- `hydrateGroup` (line 143-148) and `discoverDevices` (line 237-241) call only
  `getDeviceCount` / `getDevices` → **encrypted devices are currently invisible** to the
  SDK, CLI, plugin, and dashboard. Both must also read `getEncryptedDeviceCount` /
  `getEncryptedDevices`.
- `hydrateDevice` / `hydrateAgent`: detect and persist the encrypted flag; add reader
  capabilities via `isAuthorizedReader` on both channels. These hydrate from contract
  reads, not events, so they still need an `isEncrypted()` call — unless discovery passes
  down which set the entity came from (which is why §11.4 is still worth doing).
- `registerDevice` / `registerAgent` / (registry `createChannel`): add an `encrypted`
  option routing to `registerEncryptedDevice` / `registerEncryptedAgent` /
  `createEncryptedChannel`. These three already decode the receipt event (lines 488, 519),
  so they get the `encrypted` flag **for free** from the event (§11.1) — no extra
  `isEncrypted()` call on the registration path.
- New: `grantChannelReader` / `revokeChannelReader` with a `"incoming" | "outgoing"`
  selector for device/agent targets, plus a direct-channel variant.
- `deviceRoleIds` / `agentRoleIds` stay as-is; reader status needs its own accessor (§0).

**`src/errors.ts`** — new codes: `ENCRYPTION_UNSUPPORTED`, `NOT_A_READER`,
`NO_PUBLIC_KEY`, `INSUFFICIENT_FEE`, `READ_BATCH_LIMIT`, `CTX_FAILED` /
`DISCLOSURE_TIMEOUT`.

**`src/config.ts`** — `biteRpcUrl` + migration if `Config` gains fields.
**`src/backup.ts`** — no change (the wallet file already is the ECIES key material).

---

## 4. `packages/cli`

| Command | Change |
|---|---|
| `publish.ts` | Auto-detect (encryption is a property of the target channel, not a user flag). Needs fee display, `--wait` / `--no-wait` for CTX confirmation, and output that says **scheduled** vs **published**. The two guidance helpers (`printPublisherGuidance` / `printMasterGuidance`) should gain a reader/pubkey equivalent. |
| `read.ts` | Encrypted target: default to a labelled ciphertext view; `--decrypt` (or `--disclose`) for the paid 2-phase read. `--limit` capped at 10 per request. `--json` shape gains `encrypted`. |
| `device.ts` | `register --encrypted`; new `device reader add|remove|list --channel incoming|outgoing`; `list` marks encrypted devices. |
| `agent.ts` | `register --encrypted`; `agent reader add|remove|list`; publish/notify output changes as above. |
| `register.ts` | Group registration is factory-neutral now (groups hold both factories) — no flag needed, but the help text should say a group can host both kinds. |
| `discover.ts` | `devices` must list encrypted devices (currently invisible) and mark them. |
| `whoami.ts` | Show public-key registration status and reader memberships. |
| `init.ts` | `--encrypted` for `--create-device` / `--create-agent`; offer public-key registration during setup. Sequencing trap: registering a key is a **transaction**, so it must come after funding — today `init` completes before the wallet has any balance. |
| **new** `key.ts` | `smartclaws key register|show|remove` against `PublicKeyRegistry`. |
| `index.ts` | Register the new command. |
| `runtime.ts` | No change. |

---

## 5. `packages/openclaw-plugin`

- **`tools/read.ts`** — the key design call (§12.2): keep `smartclaws_read` free and
  wallet-less (returning labelled ciphertext for encrypted channels) and add a **separate
  optional tool** (`smartclaws_read_encrypted` / `smartclaws_disclose`) that signs and
  spends. Folding decryption into `read` via a flag would turn a non-optional read-only
  tool into one that spends money — bad for the allowlist model the skills teach.
- **`tools/publish.ts` / `tools/notify.ts`** — auto-detect, include fee/`ctxHash`/scheduled
  state in the returned object. Must not return anything an agent could read as "published".
- **`tools/wallet-info.ts`** — extend with `publicKeyRegistered` (and possibly reader
  memberships), so an agent can self-diagnose why a disclosure read fails.
- **`plugin-config.ts`** — `biteRpcUrl` if it's a separate endpoint (§12.1).
- **`openclaw.plugin.json`** — `contracts.tools` list, `toolMetadata` `optional: true` for
  any new signing tool, version bump (0.2.0 → 0.3.0), configSchema mirror of the above.
- **`README.md`** — tool table.
- **`publish/smartclaws-openclaw-plugin/`** — prebuilt `dist/index.js`, manifest and
  `package.json` are checked in; regenerate.
- **`tests/unit/publish.test.ts`, `notify.test.ts`** — extend; `BITEMockup` for determinism.

---

## 6. `packages/dashboard` (mechanics only — visual design deferred)

**Hard constraint to settle before designing**: an injected browser wallet cannot perform
ECDH — MetaMask will not expose the private key, so the dashboard **cannot decrypt
disclosed messages** with a connected wallet. Three viable shapes, all design decisions:
(1) ciphertext/metadata-only view; (2) in-session viewing-key import (paste a key, never
persisted); (3) a dedicated "viewer" keypair registered as a reader and held by the
dashboard user out-of-band. This choice determines almost everything else here.

Mechanical surfaces regardless of that choice:

| File | Change |
|---|---|
| `src/config/contracts.ts` | Add `channelEncrypted` and `publicKeyRegistry` ABIs. |
| `src/hooks/use-channel-messages.ts` | Branch on `isEncrypted()`. Today every encrypted message renders through the `catch` as a decode error. Needs an explicit encrypted state, and `readMessages` returns ciphertext whose length ≠ payload length. |
| `src/hooks/use-group-detail.ts`, `use-device-groups.ts` | Read `getEncryptedDevices` / `getEncryptedDeviceCount`; device counts are currently wrong (plain-only) for mixed groups. Alternatively drive the list from `DeviceRegistered` logs and filter on the indexed `encrypted` topic (§11.1). |
| `src/hooks/use-device-detail.ts`, `use-agent-detail.ts` | Encrypted badge, reader list (`getReaders`), pubkey-registry state. |
| `src/hooks/use-access-graph.ts`, `use-access-matrix.ts`, `use-access-roles.ts`, `src/lib/roles.ts` | Readers are a new ACL dimension outside AccessControl (§0). |
| `src/hooks/use-chart-data.ts`, `components/shared/sensor-chart(s).tsx` | Encrypted channels yield no plottable telemetry — charts must degrade gracefully rather than render empty. |
| `src/hooks/use-channel-capacity.ts` | `totalBytes` now measures ciphertext; capacity math is still valid but the label ("stored bytes") is misleading vs payload size. |
| `src/hooks/use-agent-liveness.ts` | Liveness inferred from readable messages breaks on encrypted channels; `MessagePublished` events still work as a liveness signal. |
| `src/config/wagmi.ts`, `.env.local` | New `VITE_REGISTRY_ADDRESS` after redeploy. |
| `src/pages/channel-detail.tsx`, `device-detail.tsx`, `agent-detail.tsx`, `access.tsx`, `overview.tsx` | Encryption state surfacing (design). |

---

## 7. `skills/`

### New skill (the one you predicted)

`smartclaws-encrypted-channels` — an agent-facing contract for reading and writing
encrypted channels. Should require the plugin
(`metadata.openclaw.requires.config: ["plugins.entries.smartclaws"]`). Content:

- How to tell a channel is encrypted (never assume; ask the tool/`SMARTCLAWS.md`).
- Write path: what the tooling does for you, what it costs, and — critically — that a
  successful tool call means **scheduled, not stored**; how to verify; that a failed CTX
  is silent and unretryable, so verification is mandatory before claiming success.
- Read path: the prerequisites (registered public key + reader authorization, both
  owner-granted, neither self-serviceable), that reads **cost money and take a second
  transaction**, the ≤10-messages-per-request limit, and how to handle a timeout.
- Failure taxonomy mapped to what the agent should do: not-a-reader, no-public-key,
  insufficient fee, disclosure timeout, CTX reverted.
- Cost/cadence discipline: polling an encrypted incoming channel is a paid operation —
  watch `MessagePublished` / message count first, disclose only on change.
- Safety: never print decrypted payloads into shared logs by default; never write the
  viewing key anywhere.

Open shape question (§12.2): one skill, or split "operate on encrypted channels" from
"set up encryption" (key registration + reader grants, which are owner/CLI actions)?
Recommendation: **one skill**, with the setup part written as "ask the owner to run these
CLI commands" — consistent with how `smartclaws/SKILL.md` already handles wallet creation.

### Existing skills

| Skill | Change |
|---|---|
| `skills/smartclaws/SKILL.md` | The "four tools" table (line 52) is now wrong. Add an encrypted-vs-plain concept section (an owner choice made at registration time), a public-key-registration setup step, the new CLI commands, and the fact that **reads can now cost sFUEL** — the funding step (line 157) currently says "reads are free". |
| `skills/operational/smartclaws-master-agent/SKILL.md` | Cycle step 3 (read telemetry) may now be a paid, two-transaction, latency-bearing operation → affects freshness rules (step 5) and the "stale telemetry" failure rule. Step 7 (publish command) and step 8 (decision log) need scheduled≠published wording. The decision-log rule "never claim a command succeeded unless the plugin returned success" is now *insufficient* — success means submitted. |
| `skills/operational/smartclaws-bridge-agent/SKILL.md` | Telemetry cycle step 4 gains a fee/confirmation. The command cycle ("read incoming, process new offsets") is the expensive one — offset tracking now spans disclosure events rather than raw reads, and polling costs money per poll. Modes are unaffected. |
| `skills/smartclaws/templates/SMARTCLAWS.example.md` | Per-device `encryption: plain \| encrypted`, reader status, and the agent's own channel kind — in both the master and bridge variants. |
| `skills/smartclaws/templates/AGENTS.controller.md`, `AGENTS.bridge.md` | Authority language: spending sFUEL to *read* is new. Owners will want a clause about it. (Needs reading — not covered in this pass.) |
| `skills/README.md` | Catalog row for the new skill; the "How an agent uses these" list. |
| `skills/devices/*/SKILL.md` (shelly, thermal, novapm) | Topics and payloads are unchanged — encryption is transport-level. One line each stating the contract applies to both channel kinds. Low priority. |
| `.github/workflows/skills-publish.yml` | No change — it auto-discovers any directory containing a `SKILL.md`. |

---

## 8. `dev/` — new encrypted variants

Both existing bridges shell out to the CLI (`subprocess.run([SMARTCLAWS, ...])`), so
**they are blocked on the CLI work in §4** — the scripts can only be as capable as
`smartclaws publish` / `smartclaws read`.

- `dev/shelly-bridge-encrypted.py` — real hardware, encrypted channels. Publishing is a
  straightforward addition. Reading `command.switch.set` from an encrypted incoming
  channel is the hard part: the current design polls every `POLL_SECONDS` (default 10),
  and each poll would become a paid disclosure transaction. Needs an event-driven trigger
  (watch message count / `MessagePublished`, disclose only on change) — a real design
  decision, not a mechanical port (§12.6).
- `dev/thermal-sim-encrypted.py` — simulated telemetry, encrypted publish. Note
  `read_latest_relay_state()` reads the *Shelly* channel — if that one is encrypted, the
  thermal sim also needs reader authorization on a channel it doesn't own.
- Shape decision: separate `*-encrypted.py` files vs an `ENCRYPTED=1` env switch on the
  existing scripts. The env switch keeps one copy of the thermal model and Shelly RPC
  logic; separate files keep the demo scripts readable as teaching material.
- `dev/setup-local-three-agent-demo.sh` — an encrypted mode that registers encrypted
  devices/agents, registers each wallet's public key, and grants cross-agent readers
  (the master needs reader access on both bridges' outgoing channels; each bridge needs
  reader access on its own incoming channel). The grant graph is materially bigger than
  the current role graph.
- `dev/find-shelly.py`, `dev/tariff-sim.py` — unaffected.

---

## 9. Tests

- **Broken right now**: `packages/cli/tests/setup.ts:59` deploys `SmartClaws` with four
  constructor args. The constructor now takes six. Every CLI integration test
  (`channel.test.ts`, `e2e-flow.test.ts`, `register-device.test.ts`, `wallet-balance.test.ts`)
  fails against the new ABI until this is fixed — it also needs `EncryptedChannelFactory`
  and `PublicKeyRegistryFactory` artifacts imported and deployed.
- Encrypted integration tests on anvil are feasible: install the BITE precompile mocks at
  `0x…1b/1c/1d` via `anvil_setCode`, mirroring `SmartClawsChannelEncrypted.test.ts:25-34`.
  Note the mock's callback is **manual** (`bite.sendCallback()`), so tests drive the CTX
  step explicitly — that's actually convenient for asserting the scheduled/stored split.
- SDK unit tests for the new encryption service — `BITEMockup` for deterministic
  ciphertexts; never assert real confidentiality against it.
- Plugin unit tests for the new tool(s) and the changed result shapes.
- `.github/workflows/typescript.yml` — may need the mock artifacts available to the CLI
  test harness; otherwise unchanged.

---

## 10. Docs

- `README.md` — the object table (the Channel row), repo layout, and the quick start need
  the encrypted variant; "Messages use a compact envelope shape" should note the envelope
  survives encryption unchanged.
- `ARCHITECTURE.html` (53 KB, hand-authored) — needs the BITE layer: the CTX publish path,
  the disclosure path, `PublicKeyRegistry`, and the two-transaction timing. This is the
  largest single doc job.
- `packages/openclaw-plugin/README.md` — tool table.
- `smart-contracts/README.md` — already updated in the working tree. ✓
- `docs/` was empty; this file is its first occupant. A user-facing "encrypted channels
  guide" belongs here too.

---

## 11. Smart-contract leftovers I noticed (flagged, not in scope)

Listed because two of them would **significantly reduce** the downstream work above.

1. ~~**Events don't distinguish encrypted entities.**~~ — **DONE.** `ChannelCreated`,
   `AgentRegistered`, and `DeviceRegistered` now carry a trailing `bool indexed encrypted`.
   The flag is derived from the channel factory that actually built the entity
   (`SmartClaws._isEncrypted(factory)`; the group compares `factory` to
   `encryptedChannelFactory`), so the event can never disagree with what was deployed.
   Indexed, so it is filterable by topic. Non-breaking for every existing TS consumer —
   they all look events up by name and pluck a named arg. Tests pin both polarities on all
   three events (`withArgs(anyValue, …, false/true)`), mutation-checked.
   Still needed downstream: regenerate the ABIs (§1) before anything can see it.
2. ~~**`deviceAdmin = address(0)` devices can't get readers.**~~ — **DONE.**
   `SmartClawsDeviceGroup` now has owner-gated `addIncomingReader` / `removeIncomingReader` /
   `addOutgoingReader` / `removeOutgoingReader` passthroughs alongside the role passthroughs.
   They delegate to the device's own reader functions, so they succeed only while the group
   actually holds `DEVICE_ADMIN_ROLE` (the `deviceAdmin == 0` case, or after self-appointing
   via `grantDeviceAdmin`), and plain devices still revert with `EncryptedOperationUnsupported`
   from the device's `_encryptedChannel` guard. Tests pin all six paths: group-admin success,
   external-admin rejection, self-appoint override, plain-device rejection, non-owner, and
   unregistered device.
3. **`scripts/deploy.ts` never deploys an encrypted instance.** It creates a plain channel,
   agent, group, and device. So `SmartClawsChannelEncrypted` bytecode is never seeded or
   verified on Blockscout, and the encrypted agent/device/channel paths are untested at
   deploy time. The verification target list also hardcodes `channelFactory` for the
   sample device/agent.
4. **Split device sets force double queries.** — **DECIDED: keep the two sets.**
   `getDevices()` + `getEncryptedDevices()` stay as they are and consumers merge them.
   A combined getter returning bare addresses would still force a per-channel
   `isEncrypted()` call, so it saves a query round but not the detection; querying the two
   sets in parallel instead hands the caller the channel kind as free provenance, which is
   what hydration actually needs. Consumers must dedupe and report a total plus a breakdown
   (§2 `GroupFile`).

---

## 12. Decisions needed before implementation

1. **BITE RPC endpoint** — same as `config.rpcUrl`, or a separate `biteRpcUrl`? Affects
   `Config` (version bump), plugin config schema, and every consumer's setup docs.
2. **Read UX shape** — separate tool/command for paid disclosure vs a flag on the existing
   one. My recommendation: separate, so the free read-only path stays free and non-optional
   in the plugin allowlist model.
3. **Dashboard decryption strategy** — ciphertext-only / in-session viewing key / dedicated
   viewer keypair. Blocks the dashboard design work.
4. **Encrypted by default?** — does `init` / `device register` default to encrypted, opt in,
   or prompt? Affects the onboarding skill's whole narrative.
5. **Cache the channel kind in local records** (fast, can go stale) or query every time
   (always right, one extra RPC per publish)?
6. **Bridge polling cost model** for encrypted incoming commands — event-triggered
   disclosure vs fixed-interval paid polling.
7. **`@skalenetwork/privacy-sdk` as a dependency** for CTX correlation, or hand-rolled
   `bite_getCraftedCtxs` calls to keep the dependency surface small?
8. **Version strategy** — `Config` v2→v3, packages 0.3.0→0.4.0, plugin 0.2.0→0.3.0,
   and the `networks.ts` registry address rollover (old deployments become unusable).
