#!/usr/bin/env node
/** Bump version across all packages. Usage: node scripts/version-bump.mjs <new-version> */

import { readFileSync, writeFileSync } from "node:fs";

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+/.test(newVersion)) {
    console.error("Usage: node scripts/version-bump.mjs <semver>");
    process.exit(1);
}

// Keep this list identical to scripts/version-check.mjs, minus the root and pyproject which
// are handled separately. A file bumped here but unchecked there, or the reverse, is how the
// SDK and plugin drifted to being set by hand in the first place.
const jsonFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/sdk/package.json",
    "packages/cli/package.json",
    "packages/dashboard/package.json",
    "packages/openclaw-plugin/package.json",
    "packages/openclaw-plugin/openclaw.plugin.json",
    "smart-contracts/package.json",
];

for (const file of jsonFiles) {
    const content = readFileSync(file, "utf8");
    const updated = content.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${newVersion}"`);
    writeFileSync(file, updated);
    console.log(`✓ ${file}`);
}

// Python pyproject.toml
const toml = readFileSync("python/pyproject.toml", "utf8");
writeFileSync(
    "python/pyproject.toml",
    toml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`),
);
console.log("✓ python/pyproject.toml");

console.log(`\nBumped all packages to ${newVersion}`);
