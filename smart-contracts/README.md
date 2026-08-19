# SmartClaws Smart Contracts

On-chain message channels and device registry for the SmartClaws IoT platform, built on SKALE.

## Contracts

| Contract | Description |
|---|---|
| `SmartClaws` | Global registry — creates and tracks channels, device groups, and agents |
| `SmartClawsChannel` | Append-only message log with circular buffer pruning by byte capacity |
| `SmartClawsChannelEncrypted` | Encrypted variant of `SmartClawsChannel` — messages are stored and disclosed via BITE |
| `PublicKeyRegistry` | Registers per-account secp256k1 public keys used for ECIES message disclosure |
| `SmartClawsDeviceGroup` | Groups devices, handles registration and lifecycle |
| `SmartClawsAgent` | AI agent with dedicated incoming and outgoing channels |
| `SmartClawsDevice` | Immutable device record linking incoming/outgoing channels |

## Encrypted Channels (BITE)

Channels can optionally be backed by `SmartClawsChannelEncrypted`, which uses SKALE's BITE
precompiles (`@skalenetwork/bite-solidity`) instead of storing plaintext payloads.

- **Publish**: the caller encrypts `abi.encode(publisher, payload)` under the network threshold
  key (TE) off-chain and calls `publishMessage`/`publishMessageFor` with the ciphertext and a
  callback fee (`getPublishCallbackGas(size) * tx.gasprice`). This submits a Conditional
  Transaction (CTX); the message is only appended to the log once `onDecrypt` verifies the
  decrypted publisher matches the submitter and re-encrypts the payload for storage. Agents and
  devices route through this path automatically via `SmartClawsAgent`/`SmartClawsDevice`, which
  detect `isEncrypted()` and emit an `*Scheduled` event instead of `*Published` while the CTX is
  pending.
- **Disclosure**: registered readers (`addReader`/`addIncomingReader`/`addOutgoingReader`) call
  `requestMessages`, which decrypts the requested offsets and re-encrypts each one via ECIES to
  the reader's public key (looked up in `PublicKeyRegistry` at request time), emitted as
  `MessageDisclosed`. Only the reader holding the matching private key can decrypt it off-chain.
- **PublicKeyRegistry**: one registry per `SmartClaws` deployment (`registry.publicKeyRegistry()`);
  accounts self-register a secp256k1 point (`registerPublicKey`), validated on-curve.
- **Encrypted agents and devices**: `SmartClaws.registerEncryptedAgent` registers an agent whose
  incoming/outgoing channels are both `SmartClawsChannelEncrypted`. `SmartClawsDeviceGroup` is a
  neutral aggregator that holds both the plain and encrypted channel factories — every group
  exposes `registerDevice` (plain) and `registerEncryptedDevice` (BITE-encrypted), so a single
  group can mix both kinds of devices. Registered devices are tracked in two separate sets,
  surfaced via `getDevices()`/`getDeviceCount()` (plain) and `getEncryptedDevices()`/
  `getEncryptedDeviceCount()` (encrypted); `isRegisteredDevice` and role passthroughs
  (`grantPublisher`, `grantMaster`, etc.) work uniformly across both sets.

### Accepted design tradeoffs

- **Refund queue is best-effort, not per-CTX**: the protocol deposits each callback's unused gas
  into the channel only after that callback completes. Each successful callback therefore settles
  and removes the previous successful callback's payer before queuing its own payer. The queue
  advances even when the channel balance is zero, so it remains bounded while protocol refunds are
  unavailable and begins paying automatically once they are enabled. If a recipient rejects the
  native-token transfer, the refund is sent to `address(0)` so it cannot block later callbacks.
  Reverted callbacks never queue their payer, so later refunds can still be paid to an unrelated
  payer; the submitter of a reverted CTX has no on-chain recovery path for that fee.
- **No retry/cancel path for a reverted publish**: if `_completePublish` reverts in the callback
  (revoked publisher, paused/disabled channel, capacity exceeded), the message is dropped and the
  CTX cannot be resubmitted (the `ctxSender`'s key is not recoverable). Callers are expected to
  detect a missing `MessagePublished`/`MessageDisclosed` event and resubmit manually.
- **Ciphertext shape is only length-checked, not fully validated**: `publishMessage` requires the
  submitted ciphertext to be larger than `BITE.TE_RETURN_SIZE_THRESHOLD` but does not verify it
  decodes to exactly `(address, bytes)`. A malformed ciphertext only fails the submitter's own CTX
  (via the publisher-binding check in the callback) and cannot be used to affect other users.
- **Callback gas pricing is fixed at compile time**: `PUBLISH_CALLBACK_GAS_PER_BYTE`,
  `READ_CALLBACK_GAS_PER_BYTE`, etc. are constants rather than owner-settable, and BITE precompile
  addresses are used via the default-address overloads rather than settable storage. Acceptable
  for now; revisit if opcode gas costs drift or precompile addresses change.

## Structure

```
smart-contracts/
├── contracts/          # Solidity source files
├── test/               # Mocha + Ethers tests
├── scripts/            # Deployment scripts
├── hardhat.config.ts   # Hardhat 3 config (ESM)
└── .solhint.json       # Solidity linter config
```

## Commands

```bash
npm install             # Install dependencies
npm run compile         # Compile contracts
npm test                # Run tests
npm run lint            # Lint Solidity
```

## Deploy

Set `SKALE_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in `.env`, then:

```bash
npx hardhat run scripts/deploy.ts --network baseTestnet
```

## Stack

- Hardhat 3 (ESM, TypeScript)
- Solidity 0.8.28, optimizer enabled, istanbul EVM (required by the BITE precompiles)
- OpenZeppelin Contracts 5.x
- `@skalenetwork/bite-solidity` for encrypted channels (TE + ECIES)
- Mocha + Chai + Ethers.js
