import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanBackups,
  createBackup,
  createDefaultConfig,
  deleteBackup,
  listBackups,
  restoreBackup,
  saveConfig,
  saveWallet,
  summarizeHome,
  type WalletFile,
} from "../../src/index.ts";

function seedHome(dir: string): void {
  const config = createDefaultConfig(
    "base-testnet",
    "https://rpc.example.com",
    42,
    "0xregistry",
    "controller",
    "0xWallet",
  );
  saveConfig(config, dir);
  const wallet: WalletFile = { address: "0xWallet", privateKey: "0xdeadbeef" };
  saveWallet(wallet, dir);
}

describe("backup", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  test("summarizeHome reports v2 fields and flags legacy v1", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        network: "local",
        rpcUrl: "http://127.0.0.1:8545",
        chainId: 31337,
        contractAddress: "0xregistry",
        deviceGroupAddress: "0xgroup",
      }),
    );

    const summary = summarizeHome(tempDir);
    expect(summary.configVersion).toBe(1);
    expect(summary.migratedFromV1).toBe(true);
    expect(summary.attachedGroupAddress).toBe("0xgroup");
    expect(summary.deviceCount).toBe(0);
  });

  test("createBackup copies config + wallet, excludes backups/ and cache/, wallet stays 0600", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);
    // cache should be excluded
    mkdirSync(join(tempDir, "cache"), { recursive: true });
    writeFileSync(join(tempDir, "cache", "junk.json"), "{}");

    const result = createBackup(tempDir);
    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(join(result.path, "config.json"))).toBe(true);
    expect(existsSync(join(result.path, "wallets", "default.json"))).toBe(true);
    expect(existsSync(join(result.path, "cache"))).toBe(false);
    expect(existsSync(join(result.path, "backups"))).toBe(false);

    const mode = statSync(join(result.path, "wallets", "default.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("listBackups returns newest first; clean keep/all and deleteBackup work", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);

    const first = createBackup(tempDir);
    // Force a distinct, newer mtime on a second backup.
    await Bun.sleep(5);
    const second = createBackup(tempDir);

    const backups = listBackups(tempDir);
    expect(backups.length).toBe(2);
    expect(backups[0].createdAt).toBeGreaterThanOrEqual(backups[1].createdAt);

    const keptDryRun = cleanBackups(tempDir, { keep: 1, dryRun: true });
    expect(keptDryRun.length).toBe(1);
    expect(listBackups(tempDir).length).toBe(2); // dry run deletes nothing

    const removed = cleanBackups(tempDir, { keep: 1 });
    expect(removed.length).toBe(1);
    expect(listBackups(tempDir).length).toBe(1);

    // deleteBackup by name on whichever remains
    const remaining = listBackups(tempDir)[0];
    deleteBackup(remaining.name, tempDir);
    expect(listBackups(tempDir).length).toBe(0);

    // sanity: the two created names were distinct
    expect(first.name).not.toBe(second.name);
  });

  test("cleanBackups requires a selector", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);
    createBackup(tempDir);
    expect(() => cleanBackups(tempDir, {})).toThrow("Specify what to clean");
  });

  test("deleteBackup and restoreBackup reject path-traversal names", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);
    createBackup(tempDir);

    expect(() => deleteBackup("backup-/../../etc", tempDir)).toThrow("was not found");
    expect(() => restoreBackup("backup-/../..", tempDir)).toThrow("was not found");
    // A sibling dir outside backups/ must not be reachable even if it exists.
    mkdirSync(join(tempDir, "wallets-evil"), { recursive: true });
    expect(() => deleteBackup("../wallets-evil", tempDir)).toThrow("was not found");
    expect(existsSync(join(tempDir, "wallets-evil"))).toBe(true);
  });

  test("restoreBackup is a true rollback: removes files created after the snapshot", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);

    const snapshot = createBackup(tempDir);

    // A device record added after the snapshot must not survive the restore.
    mkdirSync(join(tempDir, "devices"), { recursive: true });
    writeFileSync(join(tempDir, "devices", "later.json"), "{}");
    expect(existsSync(join(tempDir, "devices", "later.json"))).toBe(true);

    restoreBackup(snapshot.name, tempDir);
    expect(existsSync(join(tempDir, "devices", "later.json"))).toBe(false);
    // The safety backup (and snapshot) still live under backups/.
    expect(listBackups(tempDir).length).toBeGreaterThanOrEqual(2);
  });

  test("restoreBackup rewrites config from a snapshot and self-backs-up first", () => {
    tempDir = mkdtempSync(join(tmpdir(), "smartclaws-backup-"));
    seedHome(tempDir);

    const snapshot = createBackup(tempDir);

    // Mutate the live config after the snapshot.
    const mutated = createDefaultConfig(
      "base-testnet",
      "https://changed.example.com",
      99,
      "0xchanged",
      "bridge-agent",
      "0xWallet",
    );
    saveConfig(mutated, tempDir);

    const { safetyBackup } = restoreBackup(snapshot.name, tempDir);
    expect(safetyBackup).not.toBeNull();

    const restored = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(restored.rpcUrl).toBe("https://rpc.example.com");
    expect(restored.chainId).toBe(42);
    expect(restored.mode).toBe("controller");
  });
});
