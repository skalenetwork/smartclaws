import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultConfig, type Config } from "../../src/config.ts";

describe("config", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("createDefaultConfig sets fields correctly", () => {
    const config = createDefaultConfig("base-testnet", "https://rpc.example.com", 1351057110, "0xABC");
    expect(config.version).toBe(1);
    expect(config.network).toBe("base-testnet");
    expect(config.rpcUrl).toBe("https://rpc.example.com");
    expect(config.chainId).toBe(1351057110);
    expect(config.contractAddress).toBe("0xABC");
  });

  test("config round-trips through JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    const config = createDefaultConfig("base-testnet", "https://rpc.example.com", 42, "0x123");
    const path = join(tempDir, "config.json");
    writeFileSync(path, JSON.stringify(config, null, 2));

    const loaded = JSON.parse(readFileSync(path, "utf-8")) as Config;
    expect(loaded).toEqual(config);
  });

  test("missing config file is detectable", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    expect(existsSync(join(tempDir, "config.json"))).toBe(false);
  });
});
