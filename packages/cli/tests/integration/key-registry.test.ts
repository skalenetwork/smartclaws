import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { deployRegistry } from "../setup.ts";

const ANVIL_RPC = "http://127.0.0.1:8545";
const ANVIL_CHAIN_ID = 31337;
const ANVIL_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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

describe("key register|show|remove (anvil)", () => {
    let tempDir: string;
    let registryAddress: Address;

    beforeAll(async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-key-"));
        registryAddress = await deployRegistry();
        const init = await runCli(
            [
                "init",
                "--yes",
                "--mode",
                "controller",
                "--network",
                "base-testnet",
                "--rpc-url",
                ANVIL_RPC,
                "--chain-id",
                String(ANVIL_CHAIN_ID),
                "--contract",
                registryAddress,
                "--private-key",
                ANVIL_PRIVATE_KEY,
            ],
            tempDir,
        );
        expect(init.exitCode).toBe(0);
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true });
    });

    test("show reports not registered, then register, show, remove", async () => {
        const missingKey = await runCli(["key", "show"], tempDir);
        expect(missingKey.exitCode).toBe(1);
        expect(missingKey.stderr).toContain("No viewing key is stored");

        const generated = await runCli(["key", "generate"], tempDir);
        expect(generated.exitCode).toBe(0);

        const missing = await runCli(["key", "show"], tempDir);
        expect(missing.exitCode).toBe(0);
        expect(missing.stdout).toContain("Registered: no");
        expect(missing.stdout).toContain("smartclaws key register");

        const registered = await runCli(["key", "register"], tempDir);
        expect(registered.exitCode).toBe(0);
        expect(registered.stdout).toContain("Public key registered");
        expect(registered.stdout).toContain("Key:      view key");
        expect(registered.stdout).toMatch(/Tx:\s+0x[0-9a-fA-F]+/);

        const shown = await runCli(["key", "show"], tempDir);
        expect(shown.exitCode).toBe(0);
        expect(shown.stdout).toContain("Registered: yes");
        expect(shown.stdout).toMatch(/X:\s+0x[0-9a-fA-F]{64}/);
        expect(shown.stdout).toMatch(/Y:\s+0x[0-9a-fA-F]{64}/);
        expect(shown.stdout).toContain("Opens:     yes");

        const removed = await runCli(["key", "remove"], tempDir);
        expect(removed.exitCode).toBe(0);
        expect(removed.stdout).toContain("Public key removed");

        const after = await runCli(["key", "show"], tempDir);
        expect(after.exitCode).toBe(0);
        expect(after.stdout).toContain("Registered: no");

        const forgotten = await runCli(["key", "forget"], tempDir);
        expect(forgotten.exitCode).toBe(0);
    });

    /**
     * The state a disclosure cannot detect: registered, but not with the key held locally.
     * The fee is spent and the payload comes back as a decode error, so `key show` is the
     * only place this is visible before paying.
     */
    test("show reports a registered key the local view key cannot open", async () => {
        const generated = await runCli(["key", "generate"], tempDir);
        expect(generated.exitCode).toBe(0);

        const registered = await runCli(["key", "register"], tempDir);
        expect(registered.exitCode).toBe(0);
        expect(registered.stdout).toContain("Key:      view key");

        // Rotating locally without re-registering leaves the registry on the old key.
        const rotated = await runCli(["key", "generate", "--force"], tempDir);
        expect(rotated.exitCode).toBe(0);

        const stale = await runCli(["key", "show"], tempDir);
        expect(stale.exitCode).toBe(0);
        expect(stale.stdout).toContain("View key:  separate");
        expect(stale.stdout).toContain("Opens:     NO");
        expect(stale.stdout).toContain("smartclaws key register");

        // Re-registering is the whole remedy.
        const reregistered = await runCli(["key", "register"], tempDir);
        expect(reregistered.exitCode).toBe(0);
        expect(reregistered.stdout).toContain("Key:      view key");

        const fixed = await runCli(["key", "show"], tempDir);
        expect(fixed.stdout).toContain("Opens:     yes");

        await runCli(["key", "remove"], tempDir);
        await runCli(["key", "forget"], tempDir);
    });
});
