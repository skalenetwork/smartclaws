import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
const lockfile = readFileSync(join(import.meta.dir, "..", "..", "..", "bun.lock"), "utf8");

/** Lowest version accepted by a semver range like ">=0.3.9" or "^0.6.1". */
function versionFloor(range: string): [number, number, number] {
    const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) throw new Error(`no version found in range: ${range}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function gte(a: [number, number, number], b: [number, number, number]): boolean {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
}

const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
};

describe("DCAP verifier dependency audit (GHSA-796p-j2gh-9m2q)", () => {
    test("neither the manifest nor resolved lockfile contains @phala/dcap-qvl-node", () => {
        // dcap-qvl-node's published line ends at 0.3.3 and omits QE Identity /
        // QE Vendor ID checks (CVE-2026-22696). Only the pure-JS @phala/dcap-qvl is
        // allowed, and never below its patched 0.3.9 floor.
        expect(allDeps["@phala/dcap-qvl-node"]).toBeUndefined();
        expect(lockfile).not.toContain('"@phala/dcap-qvl-node"');
    });

    test("declares a single lower-bounded pure-JS dependency", () => {
        const range = allDeps["@phala/dcap-qvl"];
        expect(range).toMatch(/^>=\d+\.\d+\.\d+$/);
        expect(gte(versionFloor(range), [0, 3, 9])).toBe(true);
    });

    test("resolves @phala/dcap-qvl at or above the patched floor", () => {
        const matches = [
            ...lockfile.matchAll(/"@phala\/dcap-qvl": \["@phala\/dcap-qvl@(\d+\.\d+\.\d+)"/g),
        ];
        expect(matches).toHaveLength(1);
        const resolved = matches[0]?.[1];
        expect(resolved).toBeTruthy();
        expect(gte(versionFloor(resolved), [0, 3, 9])).toBe(true);
    });
});
