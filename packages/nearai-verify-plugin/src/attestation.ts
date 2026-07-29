// Step 4 of the verification chain: bind the message signer to attested TEE
// hardware. Ported from skills/operational/nearai-verify/attest.py and adapted
// to the pure-JS @phala/dcap-qvl 0.6.1 API.
//
// The 0.6.1 verifier performs Intel TDX quote verification and QE-identity
// checks internally and returns a single aggregate TCB status. We additionally
// enforce Intel's QE Vendor ID with a fixed-header check (defense in depth,
// see Phala dcap-qvl issue #127) and bind the verified quote's report_data to
// the recovered signer and a fresh nonce.
import {
    type Collateral,
    verify as dcapVerify,
    getCollateralFromPcs,
    Quote,
    type TcbStatus,
} from "@phala/dcap-qvl";
import type { CheckResult } from "./types.js";
import {
    buildOriginUrl,
    bytesToHex,
    constantTimeEqualBytes,
    type DirectOrigin,
    describeError,
    ECDSA_ADDRESS_BYTES,
    ECDSA_SIGNING_ALGORITHM,
    ED25519_ADDRESS_BYTES,
    ED25519_SIGNING_ALGORITHM,
    hexToBytes,
    isRecord,
    MILLISECONDS_PER_SECOND,
    mergeRequestHeaders,
    SHA_256_BYTES,
    sha256,
    TDX_REPORT_DATA_BYTES,
} from "./util.js";

export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
/** JWT claim key for the overall attestation verdict in an NRAS response. */
export const NRAS_VERDICT_CLAIM = "x-nvidia-overall-att-result";
export const INTEL_QE_VENDOR_ID = hexToBytes("939a7233f79c4ca9940a0db3957f0607");
export const DCAP_QUOTE_HEADER_LEN = 48;
export const QE_VENDOR_ID_OFFSET = 12;
/**
 * Strict MVP acceptance policy: only a fully up-to-date TCB is accepted.
 * Typed against @phala/dcap-qvl's `TcbStatus` so an upstream rename or a typo
 * is caught at compile time rather than silently flipping PASS to FAIL.
 */
export const ACCEPTED_TCB_STATUSES: readonly TcbStatus[] = ["UpToDate"];

/** Case-insensitive allowlist check so a casing change upstream cannot silently flip PASS to FAIL. */
export function tcbStatusAccepted(status: string): boolean {
    const normalized = status.trim().toLowerCase();
    return ACCEPTED_TCB_STATUSES.some((s) => s.toLowerCase() === normalized);
}

/** Fields of the attestation report we consume. */
export interface AttestationReport {
    intel_quote?: string;
    nvidia_payload?: string;
    signing_address?: string;
    signing_algo?: string;
    request_nonce?: string;
    tls_cert_fingerprint?: string;
    model_name?: string;
}

const ATTESTATION_STRING_FIELDS = [
    "intel_quote",
    "nvidia_payload",
    "signing_address",
    "signing_algo",
    "request_nonce",
    "tls_cert_fingerprint",
    "model_name",
] satisfies readonly (keyof AttestationReport)[];

function parseAttestationReport(value: unknown): AttestationReport {
    if (!isRecord(value)) {
        throw new TypeError("attestation response must be an object");
    }
    const report: AttestationReport = {};
    for (const key of ATTESTATION_STRING_FIELDS) {
        const field = value[key];
        if (field !== undefined && typeof field !== "string") {
            throw new TypeError(`attestation response ${key} must be a string`);
        }
        if (field !== undefined) report[key] = field;
    }
    return report;
}

/** A single named attestation check. */
export interface AttestationCheck {
    name: string;
    result: CheckResult;
    detail: string;
}

/** Aggregate attestation outcome for one endpoint + signer. */
export interface AttestationResult {
    checks: AttestationCheck[];
    /** True only when every check passed. */
    passed: boolean;
    /** True when any check ran and failed (distinct from unavailable). */
    failed: boolean;
    signingAddress?: string;
}

/** Injectable verifier surface, so tests need no live Intel/NVIDIA services. */
export interface DcapAdapter {
    getCollateralFromPcs(quote: Uint8Array): Promise<unknown>;
    verify(
        quote: Uint8Array,
        collateral: unknown,
        nowSecs: number,
    ): { status: TcbStatus; report: unknown };
    parseReportData(quote: Uint8Array): Uint8Array | null;
}

/** Default adapter backed by @phala/dcap-qvl, pinned to Intel PCS collateral. */
export const defaultDcapAdapter: DcapAdapter = {
    getCollateralFromPcs: (quote) => getCollateralFromPcs(Buffer.from(quote)),
    verify: (quote, collateral, nowSecs) =>
        dcapVerify(Buffer.from(quote), collateral as Collateral, nowSecs),
    parseReportData: (quote) => {
        const parsed = Quote.parse(Buffer.from(quote));
        const td = parsed.report.asTd15?.() ?? parsed.report.asTd10?.() ?? null;
        if (!td) return null;
        const base = "base" in td ? td.base : td;
        return base.reportData ?? null;
    },
};

/**
 * Enforce Intel's QE Vendor ID from the raw quote header, independent of the
 * parser. Keeps proof honest even if the verifier does not validate the field.
 */
export function verifyIntelQeVendorId(quote: Uint8Array): { ok: boolean; detail: string } {
    if (quote.length < DCAP_QUOTE_HEADER_LEN) {
        return { ok: false, detail: "DCAP quote is shorter than its 48-byte header" };
    }
    const actual = quote.subarray(
        QE_VENDOR_ID_OFFSET,
        QE_VENDOR_ID_OFFSET + INTEL_QE_VENDOR_ID.length,
    );
    if (!constantTimeEqualBytes(actual, INTEL_QE_VENDOR_ID)) {
        return { ok: false, detail: `unexpected QE Vendor ID ${bytesToHex(actual)}` };
    }
    return { ok: true, detail: "Intel QE Vendor ID" };
}

/**
 * Prove the verified TDX quote's report_data binds this signer and the fresh
 * request nonce. In the MVP (no TLS fingerprint) the signer occupies the first
 * 32 bytes as the address right-padded with zeros.
 */
export function verifyReportDataBinding(params: {
    reportData: Uint8Array;
    signingAddress: string;
    requestNonce: string;
    signingAlgo?: string;
    tlsCertFingerprint?: string;
}): { ok: boolean; detail: string } {
    let signer: Uint8Array;
    let nonce: Uint8Array;
    if (params.reportData.length !== TDX_REPORT_DATA_BYTES) {
        return {
            ok: false,
            detail: `report_data must be ${TDX_REPORT_DATA_BYTES} bytes`,
        };
    }
    try {
        nonce = hexToBytes(params.requestNonce, SHA_256_BYTES);
    } catch (err) {
        return { ok: false, detail: `invalid request nonce: ${describeError(err)}` };
    }
    const algo = (params.signingAlgo ?? ECDSA_SIGNING_ALGORITHM).toLowerCase();
    if (algo !== ECDSA_SIGNING_ALGORITHM && algo !== ED25519_SIGNING_ALGORITHM) {
        return { ok: false, detail: `unsupported signing algorithm: ${algo}` };
    }
    try {
        signer = hexToBytes(
            params.signingAddress,
            algo === ECDSA_SIGNING_ALGORITHM ? ECDSA_ADDRESS_BYTES : ED25519_ADDRESS_BYTES,
        );
    } catch (err) {
        return { ok: false, detail: `invalid signing address: ${describeError(err)}` };
    }

    let expectedSigner: Uint8Array;
    let signerLabel: string;
    if (params.tlsCertFingerprint) {
        let fp: Uint8Array;
        try {
            fp = hexToBytes(params.tlsCertFingerprint, SHA_256_BYTES);
        } catch (err) {
            return { ok: false, detail: `invalid TLS fingerprint: ${describeError(err)}` };
        }
        const material = new Uint8Array(signer.length + fp.length);
        material.set(signer, 0);
        material.set(fp, signer.length);
        // sha256(address || tls_fingerprint)
        expectedSigner = sha256(material);
        signerLabel = "signer + TLS fingerprint";
    } else {
        expectedSigner = new Uint8Array(SHA_256_BYTES);
        expectedSigner.set(signer, 0);
        signerLabel = "signer";
    }

    const signerOk = constantTimeEqualBytes(
        params.reportData.subarray(0, SHA_256_BYTES),
        expectedSigner,
    );
    const nonceOk = constantTimeEqualBytes(
        params.reportData.subarray(SHA_256_BYTES, TDX_REPORT_DATA_BYTES),
        nonce,
    );
    if (signerOk && nonceOk) {
        return { ok: true, detail: `verified quote binds ${signerLabel} and fresh nonce` };
    }
    const failed: string[] = [];
    if (!signerOk) failed.push(`${signerLabel} mismatch`);
    if (!nonceOk) failed.push("nonce mismatch (possible replay)");
    return { ok: false, detail: failed.join(", ") };
}

/** Accept only explicit NVIDIA pass values; truthiness is not a verdict. */
export function nvidiaVerdictPassed(verdict: unknown): boolean {
    if (verdict === true) return true;
    if (typeof verdict === "string") {
        return ["pass", "passed", "true"].includes(verdict.trim().toLowerCase());
    }
    return false;
}

/** Submit GPU evidence to NVIDIA NRAS and require an explicit passing verdict. */
export async function verifyGpu(params: {
    nvidiaPayload: string;
    nonce: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<{ result: CheckResult; detail: string }> {
    if (!params.nvidiaPayload) return { result: "SKIP", detail: "no nvidia_payload in report" };
    const fetchImpl = params.fetchImpl ?? fetch;

    let payload: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(params.nvidiaPayload);
        if (!isRecord(parsed)) {
            return { result: "FAIL", detail: "nvidia_payload must be a JSON object" };
        }
        payload = parsed;
    } catch {
        return { result: "FAIL", detail: "nvidia_payload is not valid JSON" };
    }

    const evidenceNonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (evidenceNonce.toLowerCase() !== params.nonce.toLowerCase()) {
        return {
            result: "FAIL",
            detail: "GPU evidence nonce does not match our nonce (possible replay)",
        };
    }

    let claims: Record<string, unknown>;
    try {
        const response = await fetchImpl(NRAS_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: params.signal,
        });
        const body: unknown = await response.json();
        if (!Array.isArray(body) || !Array.isArray(body[0]) || typeof body[0][1] !== "string") {
            throw new TypeError("NVIDIA NRAS response did not contain a JWT");
        }
        const jwt = body[0][1];
        let claimsB64 = jwt.split(".")[1];
        claimsB64 += "=".repeat((4 - (claimsB64.length % 4)) % 4);
        const decodedClaims: unknown = JSON.parse(
            Buffer.from(claimsB64, "base64url").toString("utf8"),
        );
        if (!isRecord(decodedClaims)) {
            throw new TypeError("NVIDIA NRAS JWT claims must be an object");
        }
        claims = decodedClaims;
    } catch (err) {
        return {
            result: "SKIP",
            detail: `NVIDIA NRAS unreachable (${describeError(err)}) - cannot verify GPU`,
        };
    }

    const verdict = claims[NRAS_VERDICT_CLAIM];
    if (nvidiaVerdictPassed(verdict)) {
        return { result: "PASS", detail: "GPU attested by NVIDIA" };
    }
    return { result: "FAIL", detail: `NVIDIA verdict did not pass: ${JSON.stringify(verdict)}` };
}

/** Fetch the attestation report scoped to a signer and fresh nonce. */
export async function fetchAttestationReport(params: {
    origin: DirectOrigin;
    signingAddress: string;
    nonce: string;
    apiKey: string;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<AttestationReport> {
    const fetchImpl = params.fetchImpl ?? fetch;
    const url = buildOriginUrl(params.origin, "/v1/attestation/report", {
        signing_algo: ECDSA_SIGNING_ALGORITHM,
        nonce: params.nonce,
        signing_address: params.signingAddress,
    });
    const response = await fetchImpl(url, {
        method: "GET",
        headers: mergeRequestHeaders(params.headers, {
            authorization: `Bearer ${params.apiKey}`,
            accept: "application/json",
        }),
        signal: params.signal,
    });
    if (!response.ok) throw new Error(`attestation report fetch failed: HTTP ${response.status}`);
    return parseAttestationReport(await response.json());
}

/**
 * Verify a full attestation report: Intel quote, QE Vendor ID, signer + nonce
 * binding, and NVIDIA GPU attestation. Returns per-check results plus an
 * aggregate pass/fail.
 */
export async function verifyAttestationReport(params: {
    report: AttestationReport;
    recoveredAddress: string;
    nonce: string;
    dcap?: DcapAdapter;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    now?: () => number;
}): Promise<AttestationResult> {
    const dcap = params.dcap ?? defaultDcapAdapter;
    const now = params.now ?? Date.now;
    const checks: AttestationCheck[] = [];
    const report = params.report;

    // Nonce echo.
    const echoed = report.request_nonce;
    checks.push({
        name: "nonce freshness",
        result: echoed === params.nonce ? "PASS" : "FAIL",
        detail: echoed === params.nonce ? "echoed our nonce" : "attestation did not echo our nonce",
    });

    // The report must bind the same signer we recovered from the message.
    const reportSigner = (report.signing_address ?? "").toLowerCase();
    const signerMatch =
        reportSigner.length > 0 && reportSigner === params.recoveredAddress.toLowerCase();
    checks.push({
        name: "signer identity",
        result: signerMatch ? "PASS" : "FAIL",
        detail: signerMatch
            ? "attested signer matches recovered signer"
            : "attested signer does not match recovered signer",
    });

    // Intel TDX quote + QE Vendor ID + report_data binding.
    const quoteHex = report.intel_quote ?? "";
    if (!quoteHex) {
        checks.push({
            name: "Intel TDX quote",
            result: "SKIP",
            detail: "no intel_quote in report",
        });
        checks.push({
            name: "signer + nonce binding",
            result: "SKIP",
            detail: "no verified quote",
        });
    } else {
        let quote: Uint8Array;
        try {
            quote = hexToBytes(quoteHex);
        } catch {
            quote = new Uint8Array(0);
        }
        const vendor = verifyIntelQeVendorId(quote);
        if (!vendor.ok) {
            checks.push({ name: "Intel TDX quote", result: "FAIL", detail: vendor.detail });
            checks.push({
                name: "signer + nonce binding",
                result: "FAIL",
                detail: "quote header rejected",
            });
        } else {
            // Separate collateral retrieval (infrastructure -> SKIP) from quote
            // verification (a throw means the verifier rejected the quote -> FAIL).
            let collateral: unknown;
            let collateralOk = false;
            try {
                collateral = await dcap.getCollateralFromPcs(quote);
                collateralOk = true;
            } catch (err) {
                checks.push({
                    name: "Intel TDX quote",
                    result: "SKIP",
                    detail: `quote collateral unavailable (${describeError(err)})`,
                });
                checks.push({
                    name: "signer + nonce binding",
                    result: "SKIP",
                    detail: "no verified quote",
                });
            }

            let verified: { status: TcbStatus; report: unknown } | null = null;
            if (collateralOk) {
                try {
                    verified = dcap.verify(
                        quote,
                        collateral,
                        Math.floor(now() / MILLISECONDS_PER_SECOND),
                    );
                } catch (err) {
                    // A rejected/malformed/revoked quote is a proof failure, not a skip.
                    checks.push({
                        name: "Intel TDX quote",
                        result: "FAIL",
                        detail: `quote rejected by verifier (${describeError(err)})`,
                    });
                    checks.push({
                        name: "signer + nonce binding",
                        result: "FAIL",
                        detail: "quote did not verify",
                    });
                }
            }

            if (verified) {
                const statusOk = tcbStatusAccepted(verified.status);
                checks.push({
                    name: "Intel TDX quote",
                    result: statusOk ? "PASS" : "FAIL",
                    detail: statusOk
                        ? `${vendor.detail}; TCB ${verified.status}`
                        : `TCB status ${verified.status}`,
                });
                if (!statusOk) {
                    checks.push({
                        name: "signer + nonce binding",
                        result: "FAIL",
                        detail: "quote did not verify",
                    });
                } else {
                    const reportData = dcap.parseReportData(quote);
                    if (!reportData) {
                        checks.push({
                            name: "signer + nonce binding",
                            result: "SKIP",
                            detail: "verified quote did not expose TD report_data",
                        });
                    } else {
                        const binding = verifyReportDataBinding({
                            reportData,
                            signingAddress: report.signing_address ?? "",
                            requestNonce: params.nonce,
                            signingAlgo: report.signing_algo,
                            tlsCertFingerprint: report.tls_cert_fingerprint,
                        });
                        checks.push({
                            name: "signer + nonce binding",
                            result: binding.ok ? "PASS" : "FAIL",
                            detail: binding.detail,
                        });
                    }
                }
            }
        }
    }

    // NVIDIA GPU attestation.
    const gpu = await verifyGpu({
        nvidiaPayload: report.nvidia_payload ?? "",
        nonce: params.nonce,
        fetchImpl: params.fetchImpl,
        signal: params.signal,
    });
    checks.push({ name: "NVIDIA GPU attestation", result: gpu.result, detail: gpu.detail });

    const failed = checks.some((c) => c.result === "FAIL");
    const skipped = checks.some((c) => c.result === "SKIP");
    return {
        checks,
        passed: !failed && !skipped,
        failed,
        signingAddress: report.signing_address,
    };
}
