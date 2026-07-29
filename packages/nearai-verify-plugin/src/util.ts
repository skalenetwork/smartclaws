// Shared, side-effect-free helpers: origin validation, hashing, hex, and
// constant-time comparison. Keeping these in one place makes the security
// invariants easy to audit.
import { createHash, timingSafeEqual } from "node:crypto";

/** Hosts under this suffix are the only accepted direct completions endpoints. */
export const NEAR_DIRECT_HOST_SUFFIX = ".completions.near.ai";
export const SHA_256_ALGORITHM = "sha256";
export const SHA_256_BYTES = 32;
export const ECDSA_ADDRESS_BYTES = 20;
export const ED25519_ADDRESS_BYTES = 32;
export const TDX_REPORT_DATA_BYTES = 64;
export const ECDSA_SIGNING_ALGORITHM = "ecdsa";
export const ED25519_SIGNING_ALGORITHM = "ed25519";
export const MILLISECONDS_PER_SECOND = 1_000;

/**
 * Merge caller headers with transport-owned values. `Headers.set` replaces
 * existing names case-insensitively, preventing duplicate Authorization or
 * Content-Type values such as `old, Bearer ...`.
 */
export function mergeRequestHeaders(
    callerHeaders: Record<string, string> | undefined,
    requiredHeaders: Record<string, string>,
): Headers {
    const headers = new Headers(callerHeaders);
    for (const [name, value] of Object.entries(requiredHeaders)) {
        headers.set(name, value);
    }
    return headers;
}

/** True for non-null, non-array objects received from untyped JSON. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Stable diagnostic text that preserves both an Error's class and message. */
export function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** SHA-256 of the given bytes, as a lowercase hex string. */
export function sha256Hex(bytes: Uint8Array): string {
    return createHash(SHA_256_ALGORITHM).update(bytes).digest("hex");
}

/** SHA-256 of the given bytes, as a Uint8Array. */
export function sha256(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(createHash(SHA_256_ALGORITHM).update(bytes).digest());
}

/** Lowercase hex of a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
}

/** Strict hex decode. Throws on odd length or non-hex characters. */
export function hexToBytes(value: string, expectedBytes?: number): Uint8Array {
    const raw = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
    if (raw.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(raw)) {
        throw new Error("value is not valid hex");
    }
    if (expectedBytes !== undefined && raw.length !== expectedBytes * 2) {
        throw new Error(`value must be exactly ${expectedBytes} bytes of hex`);
    }
    const out = new Uint8Array(raw.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Constant-time equality for two byte arrays of any length. */
export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Constant-time equality for two hex strings. Returns false (without leaking
 * timing) when either string is malformed or lengths differ.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
    let ba: Uint8Array;
    let bb: Uint8Array;
    try {
        ba = hexToBytes(a);
        bb = hexToBytes(b);
    } catch {
        return false;
    }
    return constantTimeEqualBytes(ba, bb);
}

/** A validated direct completions origin plus derived verification URLs. */
export interface DirectOrigin {
    /** Scheme + host, no trailing slash (e.g. `https://x.completions.near.ai`). */
    origin: string;
    /** Host without port. */
    host: string;
}

/**
 * Validate that a base URL points at a NEAR direct completions endpoint and
 * return its canonical origin. Rejects non-HTTPS schemes, userinfo, explicit
 * ports, fragments, and hosts outside the direct suffix.
 */
export function validateDirectOrigin(baseUrl: string): DirectOrigin | null {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port) return null;
    if (url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(NEAR_DIRECT_HOST_SUFFIX)) return null;
    return { origin: `https://${host}`, host };
}

/**
 * Build a verification URL on a validated origin. The path is fixed by the
 * caller; query params are appended safely.
 */
export function buildOriginUrl(
    origin: DirectOrigin,
    path: string,
    params?: Record<string, string>,
): string {
    const url = new URL(path, `${origin.origin}/`);
    if (url.origin !== origin.origin) {
        throw new Error("refusing to build a cross-origin verification URL");
    }
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}
