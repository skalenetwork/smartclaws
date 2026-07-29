import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";

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
];

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

describe("init command", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("creates a non-interactive controller HOME with generated wallet", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const result = await runCli(
            [
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
            ],
            tempDir,
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("SmartClaws HOME initialized");
        expect(result.stdout).toContain("Mode:      controller");

        const config = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
        const wallet = JSON.parse(readFileSync(join(tempDir, "wallets", "default.json"), "utf-8"));
        expect(config.version).toBe(2);
        expect(config.mode).toBe("controller");
        expect(config.walletAddress).toBe(wallet.address);
    });

    test("uses the network registry address when --contract is omitted", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const result = await runCli(
            [
                "init",
                "--yes",
                "--mode",
                "controller",
                "--network",
                "base-testnet",
                "--generate-wallet",
            ],
            tempDir,
        );

        expect(result.exitCode).toBe(0);

        const config = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
        expect(config.contractAddress).toBe("0x2A49ADe245fE42E6C3eBC7972bB0Fe324fc923b5");
    });

    test("rejects bridge-agent init without an agent and one device", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const result = await runCli(
            [
                "init",
                "--yes",
                "--mode",
                "bridge-agent",
                "--network",
                "base-testnet",
                "--rpc-url",
                "http://127.0.0.1:0",
                "--chain-id",
                "31337",
                "--contract",
                "0x0000000000000000000000000000000000000001",
                "--generate-wallet",
            ],
            tempDir,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("bridge-agent mode requires exactly one agent");
    });

    test("refuses to import a different wallet into an existing HOME", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const first = await runCli(
            [
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
            ],
            tempDir,
        );
        expect(first.exitCode).toBe(0);

        const second = await runCli(
            [
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
                "--private-key",
                generatePrivateKey(),
            ],
            tempDir,
        );

        expect(second.exitCode).toBe(1);
        expect(second.stderr).toContain("This HOME belongs to");
    });

    test("re-running init on an existing HOME writes a backup", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const first = await runCli([...BASE_INIT, "--generate-wallet"], tempDir);
        expect(first.exitCode).toBe(0);
        expect(existsSync(join(tempDir, "backups"))).toBe(false);

        const second = await runCli(BASE_INIT, tempDir);
        expect(second.exitCode).toBe(0);
        expect(second.stdout).toContain("Existing SmartClaws HOME found");
        expect(second.stdout).toContain("Backup saved");

        const backups = readdirSync(join(tempDir, "backups"));
        expect(backups.length).toBe(1);
        expect(existsSync(join(tempDir, "backups", backups[0], "config.json"))).toBe(true);
        expect(existsSync(join(tempDir, "backups", backups[0], "wallets", "default.json"))).toBe(
            true,
        );
    });

    test("init --no-backup skips the backup on re-init", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));

        const first = await runCli([...BASE_INIT, "--generate-wallet"], tempDir);
        expect(first.exitCode).toBe(0);

        const second = await runCli([...BASE_INIT, "--no-backup"], tempDir);
        expect(second.exitCode).toBe(0);
        expect(second.stdout).toContain("Skipping backup");
        expect(existsSync(join(tempDir, "backups"))).toBe(false);
    });
});
