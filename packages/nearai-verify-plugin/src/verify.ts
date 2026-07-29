// Verification orchestration: run the full message -> signature -> attestation
// chain for one captured request/response and produce a settled record.
import { randomBytes } from "node:crypto";
import {
  type AttestationResult,
  fetchAttestationReport,
  verifyAttestationReport,
} from "./attestation.js";
import { AttestationCache, attestationCacheKey } from "./cache.js";
import { fetchSignaturePayload, verifySignaturePayload } from "./signature.js";
import {
  combineStatus,
  deriveEvidence,
  type VerificationCheck,
  type VerificationJobInput,
  type VerificationRecord,
} from "./types.js";
import {
  describeError,
  type DirectOrigin,
  ECDSA_SIGNING_ALGORITHM,
  validateDirectOrigin,
} from "./util.js";

/** Collaborators, all injectable so verification can be tested offline. */
export interface VerifyDeps {
  cache: AttestationCache;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** 32-byte hex nonce generator; overridable in tests. */
  makeNonce?: () => string;
  /** Attestation adapter override forwarded to verifyAttestationReport. */
  dcap?: Parameters<typeof verifyAttestationReport>[0]["dcap"];
}

/**
 * Verify one captured message end to end. Always resolves with a settled
 * record; failures inside the chain become FAIL/SKIP checks rather than throws.
 */
export async function verifyMessage(
  input: VerificationJobInput,
  deps: VerifyDeps,
  signal?: AbortSignal,
): Promise<VerificationRecord> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const makeNonce = deps.makeNonce ?? (() => randomBytes(32).toString("hex"));

  const record: VerificationRecord = {
    startedAt,
    sessionId: input.sessionId,
    endpoint: input.endpoint,
    model: input.model,
    chatId: input.chatId,
    requestHash: input.requestHash,
    responseHash: input.responseHash,
    checks: [],
    status: "SKIP",
    evidence: "CLAIMED",
  };

  const origin = validateDirectOrigin(input.endpoint);
  if (!origin) {
    record.checks.push({ name: "endpoint", result: "SKIP", detail: "not a NEAR direct completions origin" });
    return settle(record, false, now);
  }

  // Step 2 + 3: signature.
  const checks: VerificationCheck[] = [];
  let signatureProven = false;
  let recoveredAddress: string | undefined;
  let signingAlgo = ECDSA_SIGNING_ALGORITHM;
  try {
    const payload = await fetchSignaturePayload({
      origin,
      chatId: input.chatId,
      apiKey: input.apiKey,
      headers: input.headers,
      fetchImpl: deps.fetchImpl,
      signal,
    });
    if (payload.signing_algo) signingAlgo = payload.signing_algo;
    const sig = await verifySignaturePayload(payload, input.model, input.requestHash, input.responseHash);
    record.signingAddress = sig.signingAddress;
    record.recoveredAddress = sig.recoveredAddress;
    record.signatureKind = sig.signatureKind;
    record.signatureKindPresent = sig.signatureKindPresent;
    recoveredAddress = sig.recoveredAddress;
    signatureProven = sig.proven;
    checks.push({ name: "message signature", result: sig.status, detail: sig.detail });
  } catch (err) {
    checks.push({
      name: "message signature",
      result: "SKIP",
      detail: `signature unavailable: ${describeError(err)}`,
    });
  }

  // Step 4: attestation (only meaningful once we have a recovered signer).
  if (recoveredAddress && signatureProven) {
    const lookup = await attest(origin, recoveredAddress, signingAlgo, input, deps, makeNonce, signal);
    for (const c of lookup.result.checks) checks.push(c);
    record.attestationCacheAgeMs = lookup.cacheAgeMs;
    record.attestationVerifyMs = lookup.verifyMs;
    if (lookup.stale) {
      checks.push({ name: "attestation freshness", result: "SKIP", detail: "served stale attestation; downgraded" });
    }
  } else if (recoveredAddress) {
    checks.push({ name: "hardware attestation", result: "SKIP", detail: "signature not proven on a direct endpoint" });
  } else {
    checks.push({ name: "hardware attestation", result: "SKIP", detail: "no recovered signer to attest" });
  }

  record.checks = checks;
  const hasProvenChain = signatureProven && !checks.some((c) => c.result === "FAIL" || c.result === "SKIP");
  return settle(record, hasProvenChain, now);
}

async function attest(
  origin: DirectOrigin,
  recoveredAddress: string,
  signingAlgo: string,
  input: VerificationJobInput,
  deps: VerifyDeps,
  makeNonce: () => string,
  signal: AbortSignal | undefined,
): Promise<{ result: AttestationResult; cacheAgeMs: number; stale: boolean; verifyMs: number }> {
  const now = deps.now ?? Date.now;
  const key = attestationCacheKey(origin.origin, recoveredAddress, signingAlgo);
  let verifyMs = 0;
  const refresh = async (): Promise<AttestationResult> => {
    const startedAt = now();
    const nonce = makeNonce();
    const report = await fetchAttestationReport({
      origin,
      signingAddress: recoveredAddress,
      nonce,
      apiKey: input.apiKey,
      headers: input.headers,
      fetchImpl: deps.fetchImpl,
      signal,
    });
    const result = await verifyAttestationReport({
      report,
      recoveredAddress,
      nonce,
      dcap: deps.dcap,
      fetchImpl: deps.fetchImpl,
      signal,
      now,
    });
    verifyMs = now() - startedAt;
    return result;
  };

  try {
    const lookup = await deps.cache.get(key, refresh);
    return { ...lookup, verifyMs };
  } catch (err) {
    return {
      result: {
        checks: [
          {
            name: "hardware attestation",
            result: "SKIP",
            detail: `attestation unavailable: ${describeError(err)}`,
          },
        ],
        passed: false,
        failed: false,
      },
      cacheAgeMs: 0,
      stale: false,
      verifyMs,
    };
  }
}

function settle(record: VerificationRecord, hasProvenChain: boolean, now: () => number): VerificationRecord {
  record.status = combineStatus(record.checks);
  record.evidence = deriveEvidence(record.status, hasProvenChain);
  record.durationMs = now() - record.startedAt;
  return record;
}
