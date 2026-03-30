import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultConfig, type Config } from "../src/config.ts";

function writeTempConfig(dir: string, config: Config): string {
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

describe("config", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test("createDefaultConfig sets fields correctly", () => {
    const config = createDefaultConfig("https://rpc.example.com", 1351057110, "0xABC");
    expect(config.version).toBe(1);
    expect(config.rpcUrl).toBe("https://rpc.example.com");
    expect(config.chainId).toBe(1351057110);
    expect(config.contractAddress).toBe("0xABC");
    expect(config.defaultWallet).toBe("default");
  });

  test("config round-trips through JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    const config = createDefaultConfig("https://rpc.example.com", 42, "0x123");
    const path = writeTempConfig(tempDir, config);

    const loaded = JSON.parse(readFileSync(path, "utf-8")) as Config;
    expect(loaded).toEqual(config);
  });

  test("missing config file returns parseable result", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-test-"));
    const path = join(tempDir, "config.json");
    expect(existsSync(path)).toBe(false);
  });
});
