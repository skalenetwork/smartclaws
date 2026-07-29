import { describe, expect, test } from "bun:test";
import {
    buildOriginUrl,
    constantTimeEqualHex,
    describeError,
    hexToBytes,
    mergeRequestHeaders,
    validateDirectOrigin,
} from "../src/util.js";

describe("validateDirectOrigin", () => {
    test("accepts a plain https direct host", () => {
        const origin = validateDirectOrigin("https://node1.completions.near.ai/v1");
        expect(origin).toEqual({
            origin: "https://node1.completions.near.ai",
            host: "node1.completions.near.ai",
        });
    });
    test("lowercases the host", () => {
        expect(validateDirectOrigin("https://Node1.Completions.NEAR.ai/v1")?.host).toBe(
            "node1.completions.near.ai",
        );
    });
    test.each([
        ["http scheme", "http://node1.completions.near.ai/v1"],
        ["userinfo", "https://user:pass@node1.completions.near.ai/v1"],
        ["explicit port", "https://node1.completions.near.ai:8443/v1"],
        ["fragment", "https://node1.completions.near.ai/v1#frag"],
        ["wrong suffix", "https://node1.completions.near.ai.evil.com/v1"],
        ["gateway host", "https://cloud-api.near.ai/v1"],
        ["not a url", "::::"],
    ])("rejects %s", (_label, url) => {
        expect(validateDirectOrigin(url)).toBeNull();
    });
});

describe("buildOriginUrl", () => {
    const origin = validateDirectOrigin("https://n.completions.near.ai/v1");
    if (!origin) throw new Error("test direct origin must be valid");
    test("builds a same-origin url with params", () => {
        const url = buildOriginUrl(origin, "/v1/signature/abc", { signing_algo: "ecdsa" });
        expect(url).toBe("https://n.completions.near.ai/v1/signature/abc?signing_algo=ecdsa");
    });
    test("rejects an absolute cross-origin path", () => {
        expect(() => buildOriginUrl(origin, "https://evil.com/x")).toThrow(/cross-origin/);
    });
});

describe("mergeRequestHeaders", () => {
    test("overwrites protected headers case-insensitively", () => {
        const headers = mergeRequestHeaders(
            {
                Authorization: "stale credential",
                "Content-Type": "text/plain",
                "x-request-id": "request-1",
            },
            {
                authorization: "Bearer current",
                "content-type": "application/json",
            },
        );

        expect(headers.get("authorization")).toBe("Bearer current");
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("x-request-id")).toBe("request-1");
    });
});

describe("describeError", () => {
    test("preserves an Error's name and message", () => {
        expect(describeError(new TypeError("bad value"))).toBe("TypeError: bad value");
        expect(describeError("plain failure")).toBe("plain failure");
    });
});

describe("hex + constant time", () => {
    test("hexToBytes enforces expected length", () => {
        expect(() => hexToBytes(" abcd", 2)).toThrow();
        expect(() => hexToBytes("abcd", 1)).toThrow();
        expect(Array.from(hexToBytes("0xAbCd", 2))).toEqual([0xab, 0xcd]);
    });
    test("constantTimeEqualHex compares by value", () => {
        expect(constantTimeEqualHex("00ff", "00FF")).toBe(true);
        expect(constantTimeEqualHex("00ff", "00fe")).toBe(false);
        expect(constantTimeEqualHex("00", "0000")).toBe(false);
        expect(constantTimeEqualHex("zz", "zz")).toBe(false);
    });
});
