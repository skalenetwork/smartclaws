// Verification record and status model.
//
// A record separates *lifecycle status* from *evidence level*:
//   - status: whether verification ran and what it concluded.
//   - evidence: how strong the resulting proof is.
// Only a fully passing message chain may carry `PROVEN`.

/** Lifecycle status of a single verification attempt. */
export type VerificationStatus = "PENDING" | "PASS" | "FAIL" | "SKIP";

/** Strength of the proof obtained for a message. */
export type EvidenceLevel = "CLAIMED" | "ATTESTED" | "PROVEN";

/** Result of one named check inside the verification chain. */
export type CheckResult = "PASS" | "FAIL" | "SKIP";

/** Which TEE signed the bytes. */
export type SignatureKind = "provider_tee" | "gateway";

/** One named check with a short, non-sensitive detail string. */
export interface VerificationCheck {
  name: string;
  result: CheckResult;
  detail: string;
}

/**
 * A single verification record. Contains only non-sensitive metadata; request
 * and response bodies, Authorization headers, API keys, tool arguments, and raw
 * attestation payloads are never retained here.
 */
export interface VerificationRecord {
  /** Wall-clock start time (ms since epoch). */
  startedAt: number;
  /** Total verification duration in ms, once settled. */
  durationMs?: number;
  /** Session id when the host provided one. */
  sessionId?: string;
  /** Direct completions origin that served the request. */
  endpoint: string;
  /** Requested model id. */
  model: string;
  /** Stable chat id extracted from the completion stream. */
  chatId?: string;
  /** SHA-256 of the exact request entity-body bytes (hex). */
  requestHash?: string;
  /** SHA-256 of the decoded response entity-body bytes (hex). */
  responseHash?: string;
  /** Normalized signature kind. */
  signatureKind?: SignatureKind;
  /** Whether the signature payload explicitly declared its kind. */
  signatureKindPresent?: boolean;
  /** Address returned alongside the signature payload. */
  signingAddress?: string;
  /** Address recovered from the EIP-191 signature. */
  recoveredAddress?: string;
  /** Per-check outcomes. */
  checks: VerificationCheck[];
  /** Time spent verifying hardware attestation (ms). */
  attestationVerifyMs?: number;
  /** Age of the cached attestation used, in ms (0 when freshly fetched). */
  attestationCacheAgeMs?: number;
  /** Lifecycle status. */
  status: VerificationStatus;
  /** Evidence level. */
  evidence: EvidenceLevel;
}

/** A partial record used while a verification job is in flight. */
export type PendingRecord = Omit<VerificationRecord, "status" | "evidence"> & {
  status: "PENDING";
  evidence: "CLAIMED";
};

/** Inputs captured by the transport and handed to the verification worker. */
export interface VerificationJobInput {
  /** Session id, when available. */
  sessionId?: string;
  /** Validated direct completions origin (scheme + host, no path). */
  endpoint: string;
  /** Requested model id. */
  model: string;
  /** Stable chat id from the completion stream. */
  chatId: string;
  /** SHA-256 of the exact request bytes (hex). */
  requestHash: string;
  /** SHA-256 of the decoded response bytes (hex). */
  responseHash: string;
  /** Bearer credential, confined to the job closure and cleared on settle. */
  apiKey: string;
  /** Extra request headers to forward to verification endpoints. */
  headers?: Record<string, string>;
}

/**
 * Combine per-check results into a final lifecycle status.
 *
 * One failed check makes the result FAIL. One or more unavailable checks with
 * no failures makes it SKIP. Everything passing makes it PASS.
 */
export function combineStatus(checks: VerificationCheck[]): VerificationStatus {
  if (checks.some((c) => c.result === "FAIL")) return "FAIL";
  if (checks.some((c) => c.result === "SKIP")) return "SKIP";
  if (checks.length === 0) return "SKIP";
  return "PASS";
}

/**
 * Derive the evidence level for a settled record. Only a fully passing chain
 * with a proven message signature reaches PROVEN.
 */
export function deriveEvidence(
  status: VerificationStatus,
  hasSignatureChain: boolean,
): EvidenceLevel {
  if (status === "PASS" && hasSignatureChain) return "PROVEN";
  if (status === "PASS") return "ATTESTED";
  return "CLAIMED";
}
