import { describe, expect, test } from "bun:test";
import {
    isPrivateOrUnsafeHostname,
    redactErrorMessage,
    redactRpcUrl,
    validateChainId,
    validateRegistryAddress,
    validateRpcUrl,
    SmartClawsError,
} from "../../src/index.ts";

describe("RPC validation", () => {
    test("accepts public https URLs", () => {
        expect(validateRpcUrl("https://rpc.example.com/v1")).toBe("https://rpc.example.com/v1");
    });

    test("rejects embedded credentials", () => {
        expect(() => validateRpcUrl("https://user:pass@rpc.example.com")).toThrow(SmartClawsError);
        try {
            validateRpcUrl("https://user:pass@rpc.example.com");
        } catch (error) {
            expect((error as SmartClawsError).code).toBe("CUSTOM_RPC_FORBIDDEN");
        }
    });

    test("rejects loopback and metadata hosts by default", () => {
        expect(() => validateRpcUrl("http://127.0.0.1:8545")).toThrow(SmartClawsError);
        expect(() => validateRpcUrl("http://169.254.169.254/latest")).toThrow(SmartClawsError);
        expect(() => validateRpcUrl("http://localhost:8545")).toThrow(SmartClawsError);
        expect(isPrivateOrUnsafeHostname("10.0.0.5")).toBe(true);
        expect(isPrivateOrUnsafeHostname("metadata.google.internal")).toBe(true);
    });

    test("allows private RPC when explicitly enabled", () => {
        expect(validateRpcUrl("http://127.0.0.1:8545", { allowPrivateRpc: true })).toBe(
            "http://127.0.0.1:8545/",
        );
    });

    test("rejects non-http schemes", () => {
        expect(() => validateRpcUrl("file:///etc/passwd")).toThrow(SmartClawsError);
    });

    test("validates chain IDs and registry addresses", () => {
        expect(validateChainId(1)).toBe(1);
        expect(() => validateChainId(0)).toThrow(SmartClawsError);
        expect(() => validateChainId(1.5)).toThrow(SmartClawsError);
        expect(validateRegistryAddress("0xd8c252e8fbcb9da1f3ac7b29795bc04df48d282e")).toBe(
            "0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e",
        );
        expect(() => validateRegistryAddress("not-an-address")).toThrow(SmartClawsError);
    });

    test("redacts credentials and sensitive query values", () => {
        expect(redactRpcUrl("https://user:secret@rpc.example.com/v1?apikey=abcd")).toContain(
            "REDACTED",
        );
        expect(redactRpcUrl("https://user:secret@rpc.example.com/v1?apikey=abcd")).not.toContain(
            "secret",
        );
        expect(redactErrorMessage("failed https://user:secret@rpc.example.com")).not.toContain(
            "secret",
        );
    });
});
