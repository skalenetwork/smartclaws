#!/usr/bin/env node
/** Check that all packages declare the same version as the root. */

import { readFileSync } from "node:fs";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const expected = root.version;

const files = [
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/dashboard/package.json",
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
