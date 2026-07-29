#!/usr/bin/env node
/** Bump version across all packages. Usage: node scripts/version-bump.mjs <new-version> */

import { readFileSync, writeFileSync } from "node:fs";

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+/.test(newVersion)) {
    console.error("Usage: node scripts/version-bump.mjs <semver>");
    process.exit(1);
}

const jsonFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/dashboard/package.json",
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
