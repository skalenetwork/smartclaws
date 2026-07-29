// Attestation cache. The hardware attestation report is large (~360KB) and
// proves a property of an (endpoint, signer) pair, so it is cached rather than
// re-fetched per message. Only fully passing results are cached; a stale result
// downgrades a per-message verification to SKIP, never PROVEN.
import type { AttestationResult } from "./attestation.js";

export const CACHE_FRESH_TTL_MS = 10 * 60 * 1000;
export const CACHE_STALE_IF_ERROR_MS = 60 * 60 * 1000;

interface CacheEntry {
  result: AttestationResult;
  storedAt: number;
}

/** Result of a cache lookup, including how the value was obtained. */
export interface CacheLookup {
  result: AttestationResult;
  /** Age of the returned attestation in ms (0 when freshly fetched). */
  cacheAgeMs: number;
  /** True when a fresh refresh failed and a stale value was served instead. */
  stale: boolean;
}

/** Build the cache key for an endpoint + signer + algorithm. */
export function attestationCacheKey(endpoint: string, signingAddress: string, signingAlgo: string): string {
  return `${endpoint}\u0000${signingAddress.toLowerCase()}\u0000${signingAlgo.toLowerCase()}`;
}

export class AttestationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<AttestationResult>>();
  private readonly now: () => number;
  private readonly freshTtlMs: number;
  private readonly staleIfErrorMs: number;

  constructor(options?: { now?: () => number; freshTtlMs?: number; staleIfErrorMs?: number }) {
    this.now = options?.now ?? Date.now;
    this.freshTtlMs = options?.freshTtlMs ?? CACHE_FRESH_TTL_MS;
    this.staleIfErrorMs = options?.staleIfErrorMs ?? CACHE_STALE_IF_ERROR_MS;
  }

  /**
   * Resolve an attestation for a key, refreshing when needed. `refresh` must
   * fetch and verify with a fresh nonce; it should reject or return a
   * non-passing result to indicate failure. Concurrent callers share one
   * in-flight refresh (single-flight).
   */
  async get(key: string, refresh: () => Promise<AttestationResult>): Promise<CacheLookup> {
    const cached = this.entries.get(key);
    const age = cached ? this.now() - cached.storedAt : Number.POSITIVE_INFINITY;
    if (cached && age < this.freshTtlMs) {
      return { result: cached.result, cacheAgeMs: age, stale: false };
    }

    let refreshed: AttestationResult | undefined;
    let refreshError: unknown;
    try {
      refreshed = await this.runSingleFlight(key, refresh);
    } catch (err) {
      refreshError = err;
    }

    if (refreshed && refreshed.passed) {
      this.entries.set(key, { result: refreshed, storedAt: this.now() });
      return { result: refreshed, cacheAgeMs: 0, stale: false };
    }

    // Refresh failed or did not pass. Serve a still-valid stale entry if we have
    // one, marked stale so the caller downgrades the message to SKIP.
    if (cached && age < this.staleIfErrorMs) {
      return { result: cached.result, cacheAgeMs: age, stale: true };
    }

    if (refreshed) return { result: refreshed, cacheAgeMs: 0, stale: false };
    throw refreshError ?? new Error("attestation refresh failed");
  }

  private runSingleFlight(key: string, refresh: () => Promise<AttestationResult>): Promise<AttestationResult> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await refresh();
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  /** Drop all cached entries (used on plugin disable/reload). */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}
