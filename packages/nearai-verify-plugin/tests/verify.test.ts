import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  type DcapAdapter,
  INTEL_QE_VENDOR_ID,
  NRAS_URL,
  QE_VENDOR_ID_OFFSET,
} from "../src/attestation.js";
import { AttestationCache } from "../src/cache.js";
import { type VerifyDeps, verifyMessage } from "../src/verify.js";

const MODEL = "deepseek-ai/DeepSeek-V4-Flash";
const REQ = "a".repeat(64);
const RES = "b".repeat(64);
const NONCE = "22".repeat(32);
const ENDPOINT = "https://node1.completions.near.ai";
const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

function quote(): Uint8Array {
  const q = new Uint8Array(64);
  q.set(INTEL_QE_VENDOR_ID, QE_VENDOR_ID_OFFSET);
  return q;
}

function reportData(): Uint8Array {
  const rd = new Uint8Array(64);
  rd.set(Buffer.from(account.address.slice(2), "hex").subarray(0, 32), 0);
  rd.set(Buffer.from(NONCE, "hex"), 32);
  return rd;
}

const dcap: DcapAdapter = {
  getCollateralFromPcs: async () => ({}),
  verify: () => ({ status: "UpToDate", report: {} }),
  parseReportData: () => reportData(),
};

/** Route signature, attestation, and NVIDIA NRAS requests to canned responses. */
function makeFetch(text: string): typeof fetch {
  const claims = Buffer.from(JSON.stringify({ "x-nvidia-overall-att-result": "pass" })).toString(
    "base64url",
  );
  const jwt = `h.${claims}.s`;
  return (async (url: string) => {
    if (url.includes("/v1/signature/")) {
      const signature = await account.signMessage({ message: text });
      return new Response(
        JSON.stringify({
          signature,
          signing_address: account.address,
          signing_algo: "ecdsa",
          text,
        }),
      );
    }
    if (url.includes("/v1/attestation/report")) {
      return new Response(
        JSON.stringify({
          intel_quote: Buffer.from(quote()).toString("hex"),
          signing_address: account.address,
          signing_algo: "ecdsa",
          request_nonce: NONCE,
          nvidia_payload: JSON.stringify({ nonce: NONCE }),
        }),
      );
    }
    if (url === NRAS_URL) return new Response(JSON.stringify([["x", jwt]]));
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

function deps(text: string): VerifyDeps {
  return {
    cache: new AttestationCache(),
    fetchImpl: makeFetch(text),
    now: () => 0,
    makeNonce: () => NONCE,
    dcap,
  };
}

describe("verifyMessage orchestration", () => {
  test("produces a PROVEN record for a fully valid message chain", async () => {
    const record = await verifyMessage(
      {
        sessionId: "s1",
        endpoint: ENDPOINT,
        model: MODEL,
        chatId: "chat-1",
        requestHash: REQ,
        responseHash: RES,
        apiKey: "k",
      },
      deps(`${MODEL}:${REQ}:${RES}`),
    );
    expect(record.status).toBe("PASS");
    expect(record.evidence).toBe("PROVEN");
    expect(record.recoveredAddress?.toLowerCase()).toBe(account.address.toLowerCase());
  });

  test("a single-byte response mutation breaks the signature and fails", async () => {
    const mutated = `${"b".repeat(63)}c`;
    const record = await verifyMessage(
      {
        endpoint: ENDPOINT,
        model: MODEL,
        chatId: "chat-1",
        requestHash: REQ,
        responseHash: mutated,
        apiKey: "k",
      },
      // The signature server still signs the true bytes; our local hash differs.
      deps(`${MODEL}:${REQ}:${RES}`),
    );
    expect(record.status).toBe("FAIL");
    expect(record.evidence).toBe("CLAIMED");
  });

  test("a non-direct endpoint is SKIP, never PROVEN", async () => {
    const record = await verifyMessage(
      {
        endpoint: "https://cloud-api.near.ai",
        model: MODEL,
        chatId: "c",
        requestHash: REQ,
        responseHash: RES,
        apiKey: "k",
      },
      deps(`${MODEL}:${REQ}:${RES}`),
    );
    expect(record.status).toBe("SKIP");
    expect(record.evidence).toBe("CLAIMED");
  });
});
