# Track 3C — publish and disclosure

> **LANDED 2026-08-17.** Kept as the specification of what was built, not as work to do.
> One change since: `resolveChannel` was rewritten so every entity channel is reachable by name
> on both sides — see [`03-track-4-cli.md`](./03-track-4-cli.md).

**Blocked on Track 3B.** **Read [`00-DEPLOYMENT.md`](./00-DEPLOYMENT.md) first** — shared addresses, rules and gates.

This is the highest-risk work in the project: it decides what the system *claims* about whether a
message was stored, and it spends real money on reads. Spec: roadmap "Track 3C", propagation §0.

## Files you own

```
packages/sdk/src/services/channels.ts
packages/sdk/tests/unit/channels.test.ts
packages/sdk/tests/unit/publish-state.test.ts  (new)
```

Read-only: `services/encryption.ts`, `ctx.ts`, `keys.ts`, `discovery.ts`, `readers.ts`,
`contracts.ts`, `errors.ts`. Consume them; do not modify them.

**Do not touch `packages/sdk/src/index.ts`**, even to add exports. A concurrent session is removing
backward-compatibility code from that file, and it is the only place your work would collide.
Export wiring is done separately once both land — write your module as if it were already exported
and import by path in tests.

Assume this API shape, which a concurrent removal is putting in place:

- `Config` has **no** `biteRpcUrl`, and `resolveBiteRpcUrl` no longer exists. Every SKALE node
  serves the `bite_*` methods, so build BITE clients from `config.rpcUrl`.
- `encrypted` is a **required** field on `DeviceFile` and `AgentFile`. Never write a code path that
  leaves it unset or defaults it to `false`.
- There is no legacy-registry detection, no compatibility branch, and no pre-v3 config migration.
  A registry that does not answer `publicKeyRegistry()` is simply an error.

If you find any of those still present when you start, they are mid-removal — code against the
target shape above and say so in your report rather than restoring the old form.

## 1. PublishState — the truthfulness contract

Replace the ambiguous `status: "success"` (which today only means "origin tx mined") with:

```ts
type PublishState = "published" | "scheduled" | "origin-reverted" | "ctx-reverted";
```

Rules, in the order they must be evaluated:

- Plain origin success **plus** its matching `MessagePublished` → `published`.
- Encrypted origin success without waiting (`--no-wait` style) → `scheduled`.
- Encrypted publication is `published` **only** after a successful CTX receipt carrying a matching
  `MessagePublished(channel, offset)` event.
- A successful CTX receipt **without** the expected event → treat as failure, not success.

Map the existing typed errors onto these states — the codes were designed for exactly this and
imply opposite recovery, so getting this mapping wrong is the whole risk:

| Error | State | Meaning |
|---|---|---|
| `ORIGIN_REVERTED` | `origin-reverted` | Nothing scheduled, no callback funded → safe to resubmit |
| `CTX_NOT_FOUND` | stays `scheduled` | Wait ended, CTX may still land → re-check, **never** resubmit |
| `CTX_FAILED` | `ctx-reverted` | Terminal; message dropped, funding not recoverable |
| `CTX_MALFORMED_RESPONSE` | not a publish failure | The node's response was unparseable; surface as such |

Write a dedicated test file that pins every row of that table. Treating `CTX_NOT_FOUND` as a
failure would make callers resubmit and pay twice for a message that landed.

Call the funding a **callback deposit**, never the final cost: refunds are asynchronous and a
failed callback can strand value.

## 2. Publish path

For each of `publishChannelMessage`, `publishDeviceTelemetry`, `publishDeviceCommand`,
`publishAgentOutbound`, `publishAgentInbound`:

- Detect channel kind (3B memoizes this).
- Plain: unchanged, and **must send exactly zero value** — plain channels revert with
  `NativeValueNotAccepted` on any non-zero `msg.value`. One code path cannot serve both blindly.
- Encrypted: frame → encrypt → quote fee → send with the **same explicit gas price** used for the
  quote → optionally wait for the CTX. Waiting is the default.

The framing and AAD invariants live in `services/encryption.ts` — use those helpers, do not
re-implement. The AAD is the **channel** address; the encoded publisher is the **wallet**.

## 3. Read and disclosure

`readMessages` stays **walletless and free**. Encrypted entries return `encrypted`, `rawHex`,
`ciphertextHex` and `ciphertextBytes` — and **no `decodeError`**. Reading ciphertext is a
successful read, not a decode failure.

`discloseMessages` is the paid path and must, in order:

1. require an encrypted channel and a batch of **1–10** (reject >10; never silently split into
   multiple paid transactions);
2. verify reader authorization and public-key registration up front, failing with `NOT_A_READER` /
   `NO_PUBLIC_KEY` before spending anything;
3. view-read the exact ciphertext range and sum byte lengths;
4. quote gas and send `requestMessages` with the same gas price used for the deposit;
5. wait for every CTX and collect matching `MessageDisclosed` events;
6. verify channel, reader, offsets, uniqueness and completeness;
7. ECIES-decrypt each payload and feed the raw envelope bytes straight to the existing decoder —
   the contract already unwraps the `abi.encode(bytes)` layer, so do not unwrap twice.

ECIES here has **no MAC**. A corrupt or tampered ciphertext decrypts to garbage rather than failing
loudly, so "decrypted but not a valid envelope" must surface as its own expected error class
(`InvalidDecryptedEnvelopeError` already exists), never as an internal decoder crash.

## Testing

Unit-test with the injectable `EncryptionProvider` fake from 3A. You may read live channels from
`00-DEPLOYMENT.md` for free (view calls only).

**Do not spend funds or send transactions without asking the operator first.** A live publish costs
real sFUEL and is the one thing that genuinely proves this code — but it is the operator's call,
not yours. If you believe a live test is warranted, stop and ask, stating exactly what it will cost
and which channel it will write to.

## Report

Files changed, the full error→PublishState mapping with the test that pins each row, what you
verified live vs. with fakes, and gate results verbatim.
