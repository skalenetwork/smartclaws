import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

describe("wallet", () => {
  test("generatePrivateKey produces valid key", () => {
    const key = generatePrivateKey();
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("privateKeyToAccount derives address", () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("same key produces same address", () => {
    const key = generatePrivateKey();
    const a1 = privateKeyToAccount(key);
    const a2 = privateKeyToAccount(key);
    expect(a1.address).toBe(a2.address);
  });

  test("different keys produce different addresses", () => {
    const k1 = generatePrivateKey();
    const k2 = generatePrivateKey();
    const a1 = privateKeyToAccount(k1);
    const a2 = privateKeyToAccount(k2);
    expect(a1.address).not.toBe(a2.address);
  });
});
