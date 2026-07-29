import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  fetchSignaturePayload,
  isTransientSignatureMiss,
  parseSignatureText,
  type SignaturePayload,
  verifySignaturePayload,
} from "../src/signature.js";
import { validateDirectOrigin } from "../src/util.js";

const MODEL = "deepseek-ai/DeepSeek-V4-Flash";
const REQ = "a".repeat(64);
const RES = "b".repeat(64);
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

async function signedPayload(text: string, overrides: Partial<SignaturePayload> = {}): Promise<SignaturePayload> {
  const signature = await account.signMessage({ message: text });
  return { signature, signing_address: account.address, signing_algo: "ecdsa", text, ...overrides };
}

describe("parseSignatureText", () => {
  test("three-part direct payload with matching model", () => {
    expect(parseSignatureText(`${MODEL}:${REQ}:${RES}`, MODEL)).toEqual({ ok: true, model: MODEL, req: REQ, res: RES });
  });
  test("three-part with mismatched model is rejected", () => {
    const r = parseSignatureText(`other:${REQ}:${RES}`, MODEL);
    expect(r.ok).toBe(false);
  });
  test("two-part gateway payload is not proven on direct", () => {
    const r = parseSignatureText(`${REQ}:${RES}`, MODEL);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("gateway/legacy") });
  });
});

describe("verifySignaturePayload", () => {
  test("valid direct signature is PASS + proven + provider_tee", async () => {
    const payload = await signedPayload(`${MODEL}:${REQ}:${RES}`);
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("PASS");
    expect(v.proven).toBe(true);
    expect(v.signatureKind).toBe("provider_tee");
    expect(v.recoveredAddress?.toLowerCase()).toBe(account.address.toLowerCase());
  });

  test("request hash mismatch is FAIL", async () => {
    const payload = await signedPayload(`${MODEL}:${"c".repeat(64)}:${RES}`);
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("FAIL");
    expect(v.detail).toContain("request hash");
  });

  test("response hash mismatch is FAIL", async () => {
    const payload = await signedPayload(`${MODEL}:${REQ}:${"c".repeat(64)}`);
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("FAIL");
    expect(v.detail).toContain("response hash");
  });

  test("non-hex signature is FAIL before recovery", async () => {
    const payload = await signedPayload(`${MODEL}:${REQ}:${RES}`, {
      signature: "not-hex",
    });
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("FAIL");
    expect(v.detail).toContain("valid hex");
  });

  test("tampered signature (recovered != claimed) is FAIL", async () => {
    const other = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const text = `${MODEL}:${REQ}:${RES}`;
    const payload: SignaturePayload = {
      signature: await other.signMessage({ message: text }),
      signing_address: account.address, // claims a different signer than actually signed
      signing_algo: "ecdsa",
      text,
    };
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("FAIL");
    expect(v.detail).toContain("recovered address");
  });

  test("gateway two-part payload is SKIP (never proven)", async () => {
    const payload = await signedPayload(`${REQ}:${RES}`);
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("SKIP");
    expect(v.proven).toBe(false);
  });

  test("unknown explicit signature kind is FAIL, never provider_tee", async () => {
    const payload = await signedPayload(`${MODEL}:${REQ}:${RES}`, {
      signature_kind: "future_or_invalid_kind",
    });
    const v = await verifySignaturePayload(payload, MODEL, REQ, RES);
    expect(v.status).toBe("FAIL");
    expect(v.proven).toBe(false);
    expect(v.signatureKind).toBeUndefined();
    expect(v.detail).toContain("unsupported signature kind");
  });
});

describe("isTransientSignatureMiss", () => {
  test("404 with not found is transient", () => {
    expect(isTransientSignatureMiss(404, "chat not found")).toBe(true);
    expect(isTransientSignatureMiss(404, "signature expired")).toBe(true);
  });
  test("other statuses are hard failures", () => {
    expect(isTransientSignatureMiss(401, "unauthorized")).toBe(false);
    expect(isTransientSignatureMiss(404, "bad request")).toBe(false);
  });
});

describe("fetchSignaturePayload retry", () => {
  const origin = validateDirectOrigin("https://n.completions.near.ai/v1")!;

  test("retries transient 404 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("chat not found", { status: 404 });
      }
      return new Response(JSON.stringify({ signature: "0x", signing_address: "0x", text: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    let clock = 0;
    const payload = await fetchSignaturePayload({
      origin,
      chatId: "c1",
      apiKey: "k",
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(calls).toBe(3);
    expect(payload.text).toBe("x");
  });

  test("gives up after the retry deadline", async () => {
    const fetchImpl = (async () => new Response("chat not found", { status: 404 })) as unknown as typeof fetch;
    let clock = 0;
    await expect(
      fetchSignaturePayload({
        origin,
        chatId: "c1",
        apiKey: "k",
        fetchImpl,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/deadline/);
  });

  test("hard HTTP failure is not retried", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;
    await expect(
      fetchSignaturePayload({ origin, chatId: "c1", apiKey: "k", fetchImpl }),
    ).rejects.toThrow(/HTTP 401/);
    expect(calls).toBe(1);
  });

  test("respects an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(
      fetchSignaturePayload({ origin, chatId: "c1", apiKey: "k", fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
  });
});
