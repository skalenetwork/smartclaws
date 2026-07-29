import { describe, expect, test } from "bun:test";
import type { AttestationResult } from "../src/attestation.js";
import { AttestationCache, attestationCacheKey } from "../src/cache.js";

const pass = (): AttestationResult => ({ checks: [{ name: "x", result: "PASS", detail: "" }], passed: true, failed: false });
const fail = (): AttestationResult => ({ checks: [{ name: "x", result: "FAIL", detail: "" }], passed: false, failed: true });

const KEY = attestationCacheKey("https://n.completions.near.ai", "0xAbC", "ecdsa");

describe("attestationCacheKey", () => {
  test("is case-insensitive on address and algo", () => {
    expect(attestationCacheKey("https://n", "0xABC", "ECDSA")).toBe(attestationCacheKey("https://n", "0xabc", "ecdsa"));
  });
});

describe("AttestationCache", () => {
  test("serves a fresh entry without refreshing", async () => {
    let clock = 0;
    const cache = new AttestationCache({ now: () => clock });
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      return pass();
    };
    await cache.get(KEY, refresh);
    clock += 60_000; // < 10 min
    const second = await cache.get(KEY, refresh);
    expect(calls).toBe(1);
    expect(second.stale).toBe(false);
    expect(second.cacheAgeMs).toBe(60_000);
  });

  test("refreshes after the fresh TTL expires", async () => {
    let clock = 0;
    const cache = new AttestationCache({ now: () => clock });
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      return pass();
    };
    await cache.get(KEY, refresh);
    clock += 11 * 60_000; // > 10 min
    await cache.get(KEY, refresh);
    expect(calls).toBe(2);
  });

  test("single-flights concurrent refreshes", async () => {
    const cache = new AttestationCache();
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return pass();
    };
    await Promise.all([cache.get(KEY, refresh), cache.get(KEY, refresh), cache.get(KEY, refresh)]);
    expect(calls).toBe(1);
  });

  test("serves a stale entry (downgraded) when a refresh fails", async () => {
    let clock = 0;
    const cache = new AttestationCache({ now: () => clock });
    await cache.get(KEY, async () => pass());
    clock += 11 * 60_000; // stale but within stale-if-error window
    const result = await cache.get(KEY, async () => {
      throw new Error("network down");
    });
    expect(result.stale).toBe(true);
    expect(result.result.passed).toBe(true);
  });

  test("never caches a non-passing result", async () => {
    const cache = new AttestationCache();
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      return fail();
    };
    await cache.get(KEY, refresh);
    await cache.get(KEY, refresh);
    expect(calls).toBe(2);
  });

  test("propagates a failure when there is no stale entry", async () => {
    const cache = new AttestationCache();
    await expect(
      cache.get(KEY, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
  });
});
