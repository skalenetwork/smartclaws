---
name: nearai-verify
description: >
  Check whether this agent is talking to a NEAR AI Cloud TEE endpoint or to an
  ordinary one, and cryptographically attest that endpoint. Reports which models
  the chain uses, which ones actually served recent turns, warns when a fallback
  sends prompts outside the enclave, and verifies the Intel TDX quote. Trigger
  when asked "am I private", "is this a TEE", "prove it", "which model answered
  that", or before handling sensitive data.
license: LGPL-3.0-or-later
metadata:
  openclaw:
    emoji: "🔒"
    homepage: https://github.com/skalenetwork/smartclaws
    os: ["linux", "macos"]
    requires:
      bins: ["python3"]
---

# NEAR AI — endpoint verification

Answers the type of question: **are my prompts going somewhere private?**

## Background: what NEAR AI Cloud is

NEAR AI Cloud serves models from inside hardware TEEs (Intel TDX + NVIDIA
confidential computing). Inside a TEE, the host, the GPU operator, and NEAR
itself cannot read prompts or responses. It speaks the OpenAI API, so any client
can use it by changing a base URL.

Two paths, and they are **not** equally private:

- **Direct completions** — `https://{slug}.completions.near.ai/v1`. Straight to
  the model's enclave; TLS terminates inside it. Attestable and signable.
- **Gateway** — `https://cloud-api.near.ai/v1`. Routes to any model. TEE-hosted
  models keep their guarantees; **third-party models (`openai/*`, `anthropic/*`,
  `google/*`) are proxied upstream and get no TEE guarantee at all.**

So "using NEAR" does not mean "private". The model matters as much as the host.

## The three levels

Never claim a higher level than was actually reached. Always name the level in
your answer.

### Level 1 — CLAIMED

**Proves nothing.** Reads local config and gateway logs to say which endpoint is
in use. Catches misconfiguration and silent failover; a hostile endpoint would
still look fine.

- **Needs:** `python3` (stdlib only). Always available.
- **Run:** `python3 {baseDir}/check.py` · `python3 {baseDir}/check.py --served`

### Level 2 — ATTESTED

**Proves the endpoint is genuine TEE hardware, right now.** Fetches a fresh
attestation report and validates it. Says nothing about any individual message.

- **Needs:**
  | Tool | Enables | If missing |
  | --- | --- | --- |
  | `python3` stdlib | response nonce echo | always available |
  | `cryptography` | TLS key-binding check | that one check is skipped |
  | `dcap-qvl` | Intel TDX quote verification and signer/nonce binding | those checks are skipped |
  | network to `api.trustedservices.intel.com` | Intel quote collateral | quote check is skipped |
  | network to `nras.attestation.nvidia.com` | NVIDIA GPU attestation | GPU check is skipped |

  The GPU check needs **no extra package** — only network. It runs even when
  `dcap-qvl` is absent.
- **Check reachability:** `python3 {baseDir}/attest.py --doctor`
- **Run:** `python3 {baseDir}/attest.py`

The endpoint itself needs **no API key** and attestation is **free** — it never
counts against usage. Run it as often as you like.

### Level 3 — PROVEN

**Proves this specific message was signed inside that TEE.** Not built yet.
Requires an OpenClaw provider plugin using `wrapStreamFn`: verification hashes
the exact request and response bytes, and a skill never sees those. If asked for
message-level proof, say plainly that it isn't available and that level 2 is the
ceiling today.

## Missing tools are findings, not failures

**This is the most important behaviour in this skill.** A skipped check is not
an error. Never abort a verification because a package is absent.

1. Run `python3 {baseDir}/attest.py --doctor` when you don't know the capability state.
2. Report **everything that did verify**, then name what was skipped and why.
3. Offer the exact install command `--doctor` printed. It adapts to the
   environment — active venv, `--user`, or a private venv for PEP 668
   externally-managed interpreters where plain `pip install` refuses.
4. **Ask before installing.** Installing packages changes the user's machine.
   Prefer `python3 {baseDir}/attest.py --install`, which builds a self-contained venv under
   `~/.cache/nearai-verify/venv` and touches nothing else.
5. If the user declines or lacks permission, that is fine — report the level
   actually reached and move on. A partial verification honestly labelled is
   worth more than a refusal.

Distinguish the two outcomes carefully:

- **`FAIL`** — a check ran and did not pass. Something is wrong. Say so loudly
  and do not treat the endpoint as private.
- **`SKIP`** — a check could not run. Nothing is known either way. Offer the fix.

Conflating them is the worst thing this skill could do.

## What each check means

- **nonce freshness** — the report echoes a 32-byte nonce generated this run, so
  it isn't a replay. A cached attestation is a replayed attestation; the script
  never caches reports.
- **signer + nonce binding** — after `dcap-qvl` cryptographically verifies the
  Intel quote, the verifier extracts that verified quote's `report_data`. Its
  first 32 bytes must bind the reported signing address (and the TLS
  fingerprint when requested), and its final 32 bytes must equal this run's
  nonce. A similarly named field elsewhere in the API response is not trusted.
- **TLS key binding** — SHA256 of the served certificate's SubjectPublicKeyInfo
  matches `tls_cert_fingerprint` in the report. This is the check that proves
  **our** TLS session terminates inside the attested enclave rather than at a
  proxy in front of it. The report and the certificate are read over **one**
  TLS connection: a domain can be load-balanced across several CVMs, and using
  two connections can hit different backends and report a false mismatch. CA
  verification is skipped on purpose — a TEE makes its own TLS key and need not
  be CA-signed, so trust comes from the quote and this binding, not from a
  certificate authority.
- **Intel TDX quote** — the quote validates against Intel PCS collateral, with
  its TCB status reported. `UpToDate` is good; anything else is worth surfacing.
  This covers the **CPU and the confidential VM**.
- **NVIDIA GPU attestation** — the GPU evidence is submitted to NVIDIA's
  attestation service, which returns a signed verdict. This covers the **GPU
  that actually holds the weights and your activations**. The evidence carries
  our nonce, so a stale or replayed GPU payload is rejected before submission.
  Both hardware checks are needed: TDX alone proves a confidential VM but says
  nothing about whether the GPU is in confidential mode.

## Reading a level 1 result

Four states per model:

- `[TEE]` **TEE-direct** — direct completions endpoint. Private.
- `[tee]` **TEE via gateway** — TEE model, gateway in the path. Private.
- `[!!]` **NEAR-proxied** — NEAR gateway, third-party model. **Not private.**
- `[XX]` **not NEAR** — some other provider. Not private.

`--served` is the honest one. The configured chain says what *should* happen; the
log says what *did*. They diverge exactly when it matters — during a failover,
which is silent by design.

**The fallback chain is the thing to look at.** A chain like
`DeepSeek (TEE) → gpt-oss (TEE) → gpt-5.4-mini (OpenAI)` is fully private until
both NEAR models fail, at which point the same prompt goes to OpenAI with no
warning. If prompts must never leave the enclave, the fix is a chain with no
non-TEE tail — not a note in a doc.

Exit codes: `0` all good, `1` something is not private or not fully verified,
`2` the endpoint could not be reached.

## Limits — state these when reporting

- Level 2 is a **snapshot**. It attests the endpoint at the moment it ran, not
  the turn you take five minutes later.
- `--served` reads today's gateway log only.
- Endpoint classification uses NEAR's public catalog, cached for a day. A
  stale-cache run is marked in the output.
- TEE means the operator *cannot* read your data. It is not a claim about what
  the provider's policies say they *would* do.

Docs: [Verification](https://docs.near.ai/cloud/verification/) ·
[Private Inference](https://docs.near.ai/cloud/private-inference/) ·
[`nearai-cloud-verifier`](https://github.com/nearai/nearai-cloud-verifier)
