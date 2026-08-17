# Shared context for every encrypted-channels track

Each track prompt in this directory begins by pointing here. Read this file first, then the
numbered prompt you were given.

Repo: `/home/user/Desktop/SKALE/smartclaws`, branch `encrypted-channels`.
Plan: `docs/encrypted-channels-implementation-roadmap.md` (read the **Status** section first)
and `docs/encrypted-channels-propagation.md` (**§0 is the authoritative wire contract**).

## Live deployment — SKALE base-testnet, chain 324705682

RPC `https://base-sepolia-testnet.skalenodes.com/v1/base-testnet`.
Deployed 2026-08-17. Verified live: `publicKeyRegistry()` resolves, `isEncrypted()` correctly
discriminates, and the device group is genuinely mixed.

| Contract | Address |
|---|---|
| SmartClaws registry | `0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e` |
| PublicKeyRegistry | `0xB4d6E7F75D6250eBc2374652E1f6D987BBDCA75B` |
| Device group (mixed) | `0xB0B1c866Ab9282f6A75419E7f806B78bC598664F` |
| Plain channel | `0xBFd3ED24200303A58d582c36761EA4376C09EA86` |
| Plain agent | `0x451758dD8B3ca300A7033700A41A3cda57c16acf` |
| Plain device | `0x779A9Bbc07d896E3FA65D3C83A5e324487FeAA26` |
| **Encrypted channel** | `0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf` |
| **Encrypted agent** | `0xd0c3597f90B20e00b43899Bd5e95720d47FfA183` |
| ↳ incoming / outgoing | `0x8FC85384585E81c45521f891C66765323C3E680d` / `0x4A854e7e409e5b084Ae542679058B1307273d5E2` |
| **Encrypted device** | `0x0C46cf4073b358aD862180797fF3bB73Cd6e9969` |
| ↳ incoming / outgoing | `0xc86b6E8EdF0d1F04A973668c4fcb98Eb79E8153F` / `0x28bFEaDc261D7714A094A9ecF9Db6B7BB9C81539` |

Deployer / owner of all of the above: `0x10E2c6D3678e0231aaB8D0b51a265829fA100B63`.

This is the **only** registry. Pre-encryption deployments are explicitly not supported: there are
no users to protect, so nothing degrades for an old registry — it simply fails. Do not add legacy
detection, fallbacks, or compatibility branches.

There is also **no separate BITE RPC**. Every SKALE node serves the `bite_*` methods, verified by
calling `bite_getCraftedCtxs` against the plain RPC above. Build BITE clients from `config.rpcUrl`;
`Config.biteRpcUrl` does not exist.

## Non-negotiable facts

1. **BITE cannot be simulated locally.** Anvil shims and `BITEMockup` reproduce shapes, never
   behaviour — no real threshold encryption, no real CTX crafting. Never present a mock result as
   proof of confidentiality, AAD interoperability, or fee correctness. For anything depending on
   the real wire format, record a live response as a fixture (see `tests/unit/ctx.test.ts`).
2. **Scheduled ≠ stored.** An encrypted publish's origin transaction succeeding means the message
   was *scheduled*. It is appended only in a later CTX transaction emitting
   `MessagePublished(channel, offset)`. Never report origin success as published.
3. **Free reads must stay free.** `readMessages` on an encrypted channel returns ciphertext and
   costs nothing. Disclosure is a separate, paid, explicitly-authorized operation.
4. **Reader ACLs are not AccessControl roles.** They live in an `EnumerableSet` on the channel.
5. **Measure ciphertext in bytes, not hex characters.**
6. **`encrypted` is required on `DeviceFile` and `AgentFile`**, not optional. Never reintroduce a
   path that can leave it unset or default it to `false` — publishing plaintext framing to an
   encrypted channel is the worst failure this system can produce, and the required field is what
   makes that unrepresentable rather than merely discouraged.

## Gates — every session must leave these green

```
cd /home/user/Desktop/SKALE/smartclaws
bun run lint
bun run build:packages
cd packages/sdk && bun run check && bun test
cd ../cli && bun run check && bun run test:unit
cd ../openclaw-plugin && bun run check && bun test
cd ../dashboard && bun run check
```

Type-check **after** `build:packages`, never before — cross-package type errors hide behind a
stale `packages/core/dist`. This has already caused one missed bug.

CLI integration tests need anvil and are stateful. If they fail, restart before believing it:

```
docker rm -f anvil; bash scripts/anvil.sh
cd packages/cli && bun run test:integration
```

Do not commit unless asked. Never add a Co-Authored-By trailer.
