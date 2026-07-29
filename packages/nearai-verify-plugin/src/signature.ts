// Step 2 + 3 of the verification chain: fetch the NEAR AI signature for a chat
// id, parse the signed payload, verify the request/response hashes, and recover
// the EIP-191 signer address.
import { isHex, recoverMessageAddress } from "viem";
import type { CheckResult, SignatureKind } from "./types.js";
import {
  buildOriginUrl,
  constantTimeEqualHex,
  type DirectOrigin,
  describeError,
  ECDSA_SIGNING_ALGORITHM,
  isRecord,
  mergeRequestHeaders,
} from "./util.js";

/** Bounded retry policy for transient signature 404s across load-balanced nodes. */
export const SIGNATURE_RETRY = {
  initialDelayMs: 250,
  multiplier: 2,
  maxDelayMs: 2_000,
  totalDeadlineMs: 15_000,
};

/** Raw signature payload returned by `/v1/signature/{chat_id}`. */
export interface SignaturePayload {
  signature: string;
  signing_address: string;
  signing_algo?: string;
  signature_kind?: string;
  text: string;
}

/** Outcome of parsing and cryptographically checking a signature payload. */
export interface SignatureVerification {
  status: CheckResult;
  detail: string;
  signingAddress?: string;
  recoveredAddress?: string;
  signatureKind?: SignatureKind;
  signatureKindPresent: boolean;
  /** True when the full message signature chain was proven. */
  proven: boolean;
}

function parseSignaturePayload(value: unknown): SignaturePayload {
  if (
    !isRecord(value) ||
    typeof value.signature !== "string" ||
    typeof value.signing_address !== "string" ||
    typeof value.text !== "string"
  ) {
    throw new TypeError("signature response is missing required string fields");
  }
  if (value.signing_algo !== undefined && typeof value.signing_algo !== "string") {
    throw new TypeError("signature response signing_algo must be a string");
  }
  if (value.signature_kind !== undefined && typeof value.signature_kind !== "string") {
    throw new TypeError("signature response signature_kind must be a string");
  }
  return {
    signature: value.signature,
    signing_address: value.signing_address,
    text: value.text,
    ...(value.signing_algo !== undefined ? { signing_algo: value.signing_algo } : {}),
    ...(value.signature_kind !== undefined ? { signature_kind: value.signature_kind } : {}),
  };
}

/**
 * Parse the colon-separated `text` field. Two parts is a gateway/legacy payload
 * (request:response); three parts is a direct payload (model:request:response).
 * For a direct endpoint we require the three-part form with a matching model.
 */
export function parseSignatureText(
  text: string,
  requestedModel: string,
): { ok: true; model?: string; req: string; res: string } | { ok: false; reason: string } {
  const parts = text.split(":");
  if (parts.length === 3) {
    const [model, req, res] = parts;
    if (model !== requestedModel) {
      return { ok: false, reason: "signed model prefix does not match requested model" };
    }
    return { ok: true, model, req, res };
  }
  if (parts.length === 2) {
    return {
      ok: false,
      reason: "two-part (gateway/legacy) signature payload is not proven on a direct endpoint",
    };
  }
  return { ok: false, reason: `unexpected signature text with ${parts.length} parts` };
}

/**
 * Verify a signature payload against locally computed hashes and recover the
 * signer. Pure: performs no network I/O.
 */
export async function verifySignaturePayload(
  payload: SignaturePayload,
  requestedModel: string,
  requestHash: string,
  responseHash: string,
): Promise<SignatureVerification> {
  const signatureKindPresent =
    typeof payload.signature_kind === "string" && payload.signature_kind.length > 0;

  const parsed = parseSignatureText(payload.text, requestedModel);
  if (!parsed.ok) {
    return { status: "SKIP", detail: parsed.reason, signatureKindPresent, proven: false };
  }

  if (!constantTimeEqualHex(parsed.req, requestHash)) {
    return { status: "FAIL", detail: "request hash mismatch", signatureKindPresent, proven: false };
  }
  if (!constantTimeEqualHex(parsed.res, responseHash)) {
    return {
      status: "FAIL",
      detail: "response hash mismatch",
      signatureKindPresent,
      proven: false,
    };
  }

  if (
    signatureKindPresent &&
    payload.signature_kind !== "provider_tee" &&
    payload.signature_kind !== "gateway"
  ) {
    return {
      status: "FAIL",
      detail: `unsupported signature kind: ${payload.signature_kind}`,
      signatureKindPresent,
      proven: false,
    };
  }

  let recovered: string;
  if (!isHex(payload.signature)) {
    return {
      status: "FAIL",
      detail: "signature is not valid hex",
      signatureKindPresent,
      proven: false,
    };
  }
  try {
    recovered = await recoverMessageAddress({
      message: payload.text,
      signature: payload.signature,
    });
  } catch (err) {
    return {
      status: "FAIL",
      detail: `signature recovery failed: ${describeError(err)}`,
      signatureKindPresent,
      proven: false,
    };
  }

  if (recovered.toLowerCase() !== payload.signing_address.toLowerCase()) {
    return {
      status: "FAIL",
      detail: "recovered address does not match signature payload address",
      signingAddress: payload.signing_address,
      recoveredAddress: recovered,
      signatureKindPresent,
      proven: false,
    };
  }

  // Direct signature responses normally omit signature_kind; normalize to
  // provider_tee only once the direct three-part payload is proven.
  const signatureKind: SignatureKind =
    payload.signature_kind === "gateway" ? "gateway" : "provider_tee";

  return {
    status: "PASS",
    detail: "signature valid; request and response hashes bound",
    signingAddress: payload.signing_address,
    recoveredAddress: recovered,
    signatureKind,
    signatureKindPresent,
    proven: signatureKind === "provider_tee",
  };
}

/** Distinguish a transient "chat not found / expired" 404 from a hard failure. */
export function isTransientSignatureMiss(status: number, body: string): boolean {
  if (status !== 404) return false;
  return /not found|expired/i.test(body);
}

/**
 * Fetch the signature for a chat id, retrying only the transient 404 condition
 * with bounded exponential backoff and jitter. Aborts immediately on auth,
 * validation, or other HTTP failures, and on the caller's signal.
 */
export async function fetchSignaturePayload(params: {
  origin: DirectOrigin;
  chatId: string;
  apiKey: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SignaturePayload> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const url = buildOriginUrl(params.origin, `/v1/signature/${encodeURIComponent(params.chatId)}`, {
    signing_algo: ECDSA_SIGNING_ALGORITHM,
  });
  const headers = mergeRequestHeaders(params.headers, {
    authorization: `Bearer ${params.apiKey}`,
    accept: "application/json",
  });

  const startedAt = now();
  let delay: number = SIGNATURE_RETRY.initialDelayMs;

  for (;;) {
    if (params.signal?.aborted) throw new Error("signature fetch aborted");

    const response = await fetchImpl(url, { method: "GET", headers, signal: params.signal });
    if (response.ok) {
      return parseSignaturePayload(await response.json());
    }

    const body = await safeText(response);
    if (!isTransientSignatureMiss(response.status, body)) {
      throw new Error(`signature fetch failed: HTTP ${response.status}`);
    }

    const elapsed = now() - startedAt;
    const jitter = Math.random() * delay;
    const wait = Math.min(delay + jitter, SIGNATURE_RETRY.maxDelayMs);
    if (elapsed + wait > SIGNATURE_RETRY.totalDeadlineMs) {
      throw new Error("signature not available before retry deadline");
    }
    await sleep(wait);
    delay = Math.min(delay * SIGNATURE_RETRY.multiplier, SIGNATURE_RETRY.maxDelayMs);
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
