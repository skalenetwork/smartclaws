#!/usr/bin/env node
/** Check that all packages declare the same version as the root. */

import { readFileSync } from "node:fs";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const expected = root.version;

// Every published artifact belongs here. The SDK and the plugin were missing, and because
// their versions had been set by hand they matched anyway — so this script passed while
// checking nothing about them. The plugin ships two: the package and the manifest OpenClaw
// reads, and those two must stay equal to each other as well as to the root.
const files = [
    "packages/core/package.json",
    "packages/sdk/package.json",
    "packages/cli/package.json",
    "packages/dashboard/package.json",
    "packages/openclaw-plugin/package.json",
    "packages/openclaw-plugin/openclaw.plugin.json",
    // packages/nearai-verify-plugin is deliberately absent: it is versioned independently
    // (0.1.1 against a 0.3.0 root) and is not part of this release train.
    "smart-contracts/package.json",
    "python/pyproject.toml",
];

let ok = true;
for (const file of files) {
    const content = readFileSync(file, "utf8");
    const isPython = file.endsWith(".toml");
    const match = isPython
        ? content.match(/^version\s*=\s*"([^"]+)"/m)
        : content.match(/"version"\s*:\s*"([^"]+)"/);

    const found = match?.[1];
    if (found !== expected) {
        console.error(`✗ ${file}: ${found ?? "missing"} (expected ${expected})`);
        ok = false;
    } else {
        console.log(`✓ ${file}: ${found}`);
    }
}

process.exit(ok ? 0 : 1);
