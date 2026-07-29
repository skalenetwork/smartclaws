import { describe, expect, test } from "bun:test";
import { combineStatus, deriveEvidence, type VerificationCheck } from "../src/types.js";

const check = (result: VerificationCheck["result"]): VerificationCheck => ({
    name: "c",
    result,
    detail: "",
});

describe("combineStatus", () => {
    test("any FAIL wins", () => {
        expect(combineStatus([check("PASS"), check("FAIL"), check("SKIP")])).toBe("FAIL");
    });
    test("SKIP without FAIL", () => {
        expect(combineStatus([check("PASS"), check("SKIP")])).toBe("SKIP");
    });
    test("all PASS", () => {
        expect(combineStatus([check("PASS"), check("PASS")])).toBe("PASS");
    });
    test("empty is SKIP", () => {
        expect(combineStatus([])).toBe("SKIP");
    });
});

describe("deriveEvidence", () => {
    test("PASS with proven chain is PROVEN", () => {
        expect(deriveEvidence("PASS", true)).toBe("PROVEN");
    });
    test("PASS without chain is ATTESTED", () => {
        expect(deriveEvidence("PASS", false)).toBe("ATTESTED");
    });
    test("FAIL is CLAIMED", () => {
        expect(deriveEvidence("FAIL", true)).toBe("CLAIMED");
    });
    test("SKIP is CLAIMED", () => {
        expect(deriveEvidence("SKIP", true)).toBe("CLAIMED");
    });
});
