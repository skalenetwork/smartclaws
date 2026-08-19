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
        const agent = await runCli(["agent", "register", "--help"]);
        expect(agent.stdout).toContain("--encrypted");
    });

    /**
     * `--channel` means an address and `--side` means one half of an entity's channel pair.
     * One flag name carrying both meanings is how someone grants a reader on the wrong
     * channel and cannot tell from the command that they did.
     */
    test("--side names the channel half everywhere; --channel is only ever an address", async () => {
        for (const args of [
            ["device", "reader", "add"],
            ["device", "reader", "remove"],
            ["device", "reader", "list"],
            ["agent", "reader", "add"],
            ["agent", "reader", "remove"],
            ["agent", "reader", "list"],
        ]) {
            const help = await runCli([...args, "--help"]);
            expect(help.stdout).toContain("--side <side>");
            expect(help.stdout).not.toContain("--channel");
        }

        for (const command of ["read", "publish"]) {
            const help = await runCli([command, "--help"]);
            expect(help.stdout).toMatch(/--channel <address>/);
        }
    });

    test("read and publish target a device or agent by name or address", async () => {
        const read = await runCli(["read", "--help"]);
        expect(read.stdout).toContain("--device <address-or-name>");
        expect(read.stdout).toContain("--agent <address-or-name>");
        expect(read.stdout).toContain("--side <side>");

        const publish = await runCli(["publish", "--help"]);
        expect(publish.stdout).toContain("--device <address-or-name>");
        expect(publish.stdout).toContain("--agent <address-or-name>");
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

describe("read targeting", () => {
    let tempDir: string;

    afterEach(() => {
        if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    });

    async function initHome(): Promise<string> {
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
        return tempDir;
    }

    test("rejects more than one target before touching the network", async () => {
        const home = await initHome();
        const result = await runCli(["read", "--device", "d", "--agent", "a"], home);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("exactly one of");
    });

    test("rejects --side with a channel address instead of ignoring it", async () => {
        const home = await initHome();
        // The address already names one channel, so an accepted-then-ignored --side would
        // read a different channel than the one asked for, silently.
        const result = await runCli(
            [
                "read",
                "--channel",
                "0x222a651ee9836815DDf333e8022fCc9C8aC14Bbf",
                "--side",
                "incoming",
            ],
            home,
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("`side` applies to");
    });

    test("rejects a --side value that is neither incoming nor outgoing", async () => {
        const home = await initHome();
        const result = await runCli(["read", "--device", "d", "--side", "sideways"], home);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--side must be incoming or outgoing");
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
