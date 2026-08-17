import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[], homeDir?: string) {
    const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
        cwd: join(import.meta.dir, "../.."),
        env: homeDir ? { ...process.env, SMARTCLAWS_HOME: homeDir } : process.env,
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

describe("CLI help surface", () => {
    test("init has --encrypted and no --bite-rpc-url", async () => {
        const result = await runCli(["init", "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("--encrypted");
        expect(result.stdout).not.toMatch(/bite-rpc/i);
    });

    test("publish has --wait and --no-wait", async () => {
        const result = await runCli(["publish", "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("--wait");
        expect(result.stdout).toContain("--no-wait");
    });

    test("read has --disclose and --decrypt", async () => {
        const result = await runCli(["read", "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("--disclose");
        expect(result.stdout).toContain("--decrypt");
    });

    test("device and agent register accept --encrypted and expose reader ACLs", async () => {
        const device = await runCli(["device", "register", "--help"]);
        expect(device.stdout).toContain("--encrypted");
        const deviceReader = await runCli(["device", "reader", "add", "--help"]);
        expect(deviceReader.stdout).toContain("--channel");
        const agent = await runCli(["agent", "register", "--help"]);
        expect(agent.stdout).toContain("--encrypted");
        const agentReader = await runCli(["agent", "reader", "list", "--help"]);
        expect(agentReader.stdout).toContain("--channel");
    });

    test("key register|show|remove exist", async () => {
        const result = await runCli(["key", "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("register");
        expect(result.stdout).toContain("show");
        expect(result.stdout).toContain("remove");
    });

    test("register help says a group can host both kinds", async () => {
        const result = await runCli(["register", "--help"]);
        expect(result.stdout.toLowerCase()).toContain("encrypted");
    });
});

describe("disclosure --limit cap", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    test("refuses --limit above 10 without sending a transaction", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        const init = await runCli(
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
        expect(init.exitCode).toBe(0);

        const result = await runCli(
            [
                "read",
                "--disclose",
                "--limit",
                "11",
                "--channel",
                "0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf",
            ],
            tempDir,
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("1 and 10");
        expect(result.stderr).not.toContain("Published");
    });
});
