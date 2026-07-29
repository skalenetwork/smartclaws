import { describe, expect, test } from "bun:test";
import {
  type AttestationReport,
  type DcapAdapter,
  INTEL_QE_VENDOR_ID,
  nvidiaVerdictPassed,
  QE_VENDOR_ID_OFFSET,
  verifyAttestationReport,
  verifyIntelQeVendorId,
  verifyReportDataBinding,
} from "../src/attestation.js";

const ADDR = `0x${"11".repeat(20)}`;
const NONCE = "22".repeat(32);

function makeQuote(): Uint8Array {
  const quote = new Uint8Array(64);
  quote.set(INTEL_QE_VENDOR_ID, QE_VENDOR_ID_OFFSET);
  return quote;
}

function makeReportData(signerHex = "11".repeat(20), nonceHex = NONCE): Uint8Array {
  const rd = new Uint8Array(64);
  const signer = Buffer.from(signerHex, "hex");
  rd.set(signer.subarray(0, 32), 0);
  rd.set(Buffer.from(nonceHex, "hex"), 32);
  return rd;
}

function goodReport(): AttestationReport {
  return {
    intel_quote: Buffer.from(makeQuote()).toString("hex"),
    signing_address: ADDR,
    signing_algo: "ecdsa",
    request_nonce: NONCE,
    nvidia_payload: JSON.stringify({ nonce: NONCE }),
  };
}

function passingGpuFetch(verdict = "pass"): typeof fetch {
  const claims = Buffer.from(JSON.stringify({ "x-nvidia-overall-att-result": verdict })).toString(
    "base64url",
  );
  const jwt = `h.${claims}.s`;
  return (async () =>
    new Response(JSON.stringify([["x", jwt]]), { status: 200 })) as unknown as typeof fetch;
}

function adapter(overrides: Partial<DcapAdapter> = {}): DcapAdapter {
  return {
    getCollateralFromPcs: async () => ({}),
    verify: () => ({ status: "UpToDate", report: {} }),
    parseReportData: () => makeReportData(),
    ...overrides,
  };
}

describe("verifyIntelQeVendorId", () => {
  test("accepts the Intel QE vendor id", () => {
    expect(verifyIntelQeVendorId(makeQuote()).ok).toBe(true);
  });
  test("rejects a wrong vendor id", () => {
    const quote = makeQuote();
    quote[QE_VENDOR_ID_OFFSET] ^= 0xff;
    expect(verifyIntelQeVendorId(quote).ok).toBe(false);
  });
  test("rejects a too-short quote", () => {
    expect(verifyIntelQeVendorId(new Uint8Array(10)).ok).toBe(false);
  });
});

describe("verifyReportDataBinding", () => {
  test("binds signer and nonce", () => {
    const r = verifyReportDataBinding({
      reportData: makeReportData(),
      signingAddress: ADDR,
      requestNonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });
  test("rejects a signer that is not in the quote", () => {
    const r = verifyReportDataBinding({
      reportData: makeReportData("99".repeat(20)),
      signingAddress: ADDR,
      requestNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("signer mismatch");
  });
  test("rejects a replayed (mismatched) nonce", () => {
    const r = verifyReportDataBinding({
      reportData: makeReportData("11".repeat(20), "33".repeat(32)),
      signingAddress: ADDR,
      requestNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("nonce mismatch");
  });
  test("rejects report_data of the wrong length", () => {
    expect(
      verifyReportDataBinding({
        reportData: new Uint8Array(32),
        signingAddress: ADDR,
        requestNonce: NONCE,
      }).ok,
    ).toBe(false);
  });
});

describe("nvidiaVerdictPassed", () => {
  test("accepts explicit pass values only", () => {
    for (const v of [true, "pass", "PASS", "passed", "true"])
      expect(nvidiaVerdictPassed(v)).toBe(true);
    for (const v of ["fail", "1", "yes", 1, {}, null, undefined])
      expect(nvidiaVerdictPassed(v)).toBe(false);
  });
});

describe("verifyAttestationReport", () => {
  test("passes for a well-formed report + GPU", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter(),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.passed).toBe(true);
    expect(r.failed).toBe(false);
  });

  test("fails when the TCB status is not UpToDate", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter({ verify: () => ({ status: "OutOfDate", report: {} }) }),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.failed).toBe(true);
    expect(r.checks.find((c) => c.name === "Intel TDX quote")?.result).toBe("FAIL");
  });

  test("fails when the attested signer differs from the recovered signer", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: `0x${"99".repeat(20)}`,
      nonce: NONCE,
      dcap: adapter(),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.failed).toBe(true);
    expect(r.checks.find((c) => c.name === "signer identity")?.result).toBe("FAIL");
  });

  test("fails when the nonce is not echoed", async () => {
    const r = await verifyAttestationReport({
      report: { ...goodReport(), request_nonce: "44".repeat(32) },
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter(),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.checks.find((c) => c.name === "nonce freshness")?.result).toBe("FAIL");
  });

  test("fails a report whose report_data does not bind the signer", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter({ parseReportData: () => makeReportData("99".repeat(20)) }),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.checks.find((c) => c.name === "signer + nonce binding")?.result).toBe("FAIL");
  });

  test("rejects a bad QE vendor id before verifying", async () => {
    const badQuote = makeQuote();
    badQuote[QE_VENDOR_ID_OFFSET] ^= 0xff;
    const r = await verifyAttestationReport({
      report: { ...goodReport(), intel_quote: Buffer.from(badQuote).toString("hex") },
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter(),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.checks.find((c) => c.name === "Intel TDX quote")?.result).toBe("FAIL");
  });

  test("fails a non-passing NVIDIA verdict", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter(),
      fetchImpl: passingGpuFetch("fail"),
    });
    expect(r.checks.find((c) => c.name === "NVIDIA GPU attestation")?.result).toBe("FAIL");
  });

  test("skips when quote collateral cannot be retrieved (infrastructure)", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter({
        getCollateralFromPcs: async () => {
          throw new Error("pcs unreachable");
        },
      }),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.checks.find((c) => c.name === "Intel TDX quote")?.result).toBe("SKIP");
    expect(r.checks.find((c) => c.name === "signer + nonce binding")?.result).toBe("SKIP");
    expect(r.failed).toBe(false);
  });

  test("fails when the verifier rejects the quote (throws)", async () => {
    const r = await verifyAttestationReport({
      report: goodReport(),
      recoveredAddress: ADDR,
      nonce: NONCE,
      dcap: adapter({
        verify: () => {
          throw new Error("invalid signature");
        },
      }),
      fetchImpl: passingGpuFetch(),
    });
    expect(r.checks.find((c) => c.name === "Intel TDX quote")?.result).toBe("FAIL");
    expect(r.checks.find((c) => c.name === "signer + nonce binding")?.result).toBe("FAIL");
    expect(r.failed).toBe(true);
  });
});
