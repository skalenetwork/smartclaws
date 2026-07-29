import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[], homeDir: string) {
    const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, SMARTCLAWS_HOME: homeDir },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { stdout, stderr, exitCode };
}

const BASE_INIT = [
    "init",
    "--yes",
    "--mode",
    "controller",
    "--network",
    "base-testnet",
    "--rpc-url",
    "http://127.0.0.1:0",
    "--chain-id",
    "31337",
    "--contract",
    "0x0000000000000000000000000000000000000001",
    "--generate-wallet",
];

describe("backup command", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("create, list, and clean --all", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        expect((await runCli(BASE_INIT, tempDir)).exitCode).toBe(0);

        const created = await runCli(["backup"], tempDir);
        expect(created.exitCode).toBe(0);
        expect(created.stdout).toContain("Backup saved");

        const listed = await runCli(["backup", "list"], tempDir);
        expect(listed.exitCode).toBe(0);
        expect(listed.stdout).toContain("backup-");

        const cleaned = await runCli(["backup", "clean", "--all", "--yes"], tempDir);
        expect(cleaned.exitCode).toBe(0);
        expect(cleaned.stdout).toContain("Removed 1 backup");

        const empty = await runCli(["backup", "list"], tempDir);
        expect(empty.stdout).toContain("No backups.");
    });

    test("clean without a selector fails", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        expect((await runCli(BASE_INIT, tempDir)).exitCode).toBe(0);
        await runCli(["backup"], tempDir);

        const result = await runCli(["backup", "clean", "--yes"], tempDir);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Specify what to clean");
    });
});
