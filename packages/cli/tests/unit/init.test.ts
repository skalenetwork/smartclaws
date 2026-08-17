import { afterEach, describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
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
        expect(config.version).toBe(3);
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
        expect(config.contractAddress).toBe("0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e");
    });

    test("resets a stale HOME, keeping the wallet and dropping the old deployment", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        mkdirSync(join(tempDir, "wallets"), { recursive: true });
        mkdirSync(join(tempDir, "devices"), { recursive: true });
        const wallet = {
            address: "0x10E2c6D3678e0231aaB8D0b51a265829fA100B63",
            privateKey: generatePrivateKey(),
        };
        writeFileSync(join(tempDir, "wallets", "default.json"), JSON.stringify(wallet));
        writeFileSync(
            join(tempDir, "devices", "sensor-1.json"),
            JSON.stringify({ name: "sensor-1", deviceContract: "0xOldDeploymentDevice" }),
        );
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({
                version: 2,
                network: "base-testnet",
                rpcUrl: "http://127.0.0.1:0",
                chainId: 31337,
                mode: "controller",
                walletAddress: wallet.address,
                contractAddress: "0x2A49ADe245fE42E6C3eBC7972bB0Fe324fc923b5",
                attachedGroupAddress: "0xOldGroup",
            }),
        );

        const result = await runCli(["init", "--yes", "--network", "base-testnet"], tempDir);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Backup saved:");
        expect(result.stdout).toContain("Wallet preserved.");

        // The wallet is the one thing that survives, byte for byte.
        const keptWallet = JSON.parse(
            readFileSync(join(tempDir, "wallets", "default.json"), "utf-8"),
        );
        expect(keptWallet).toEqual(wallet);

        const config = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
        expect(config.version).toBe(3);
        // The superseded registry must not be carried forward, but the local preference is.
        expect(config.contractAddress).toBe("0xD8C252E8fbcB9Da1F3ac7b29795BC04dF48d282e");
        expect(config.mode).toBe("controller");
        expect(config.attachedGroupAddress).toBe("");
        // Records naming the old deployment are gone from the HOME, kept only in the backup.
        expect(existsSync(join(tempDir, "devices", "sensor-1.json"))).toBe(false);
    });

    test("keeps a non-controller mode across a reset instead of silently downgrading", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        mkdirSync(join(tempDir, "wallets"), { recursive: true });
        writeFileSync(
            join(tempDir, "wallets", "default.json"),
            JSON.stringify({ address: "0xabc", privateKey: generatePrivateKey() }),
        );
        writeFileSync(
            join(tempDir, "config.json"),
            JSON.stringify({ version: 2, network: "base-testnet", mode: "master-agent" }),
        );

        const result = await runCli(["init", "--yes", "--network", "base-testnet"], tempDir);

        // The agent that satisfied master-agent mode lived in the old deployment, so init
        // must refuse rather than quietly re-creating the HOME as a controller — that would
        // change how a deployed node behaves without saying so.
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("Mode 'master-agent' is kept");
        expect(result.stderr).toContain("master-agent mode requires exactly one agent");
    });

    test("refuses --no-backup on a stale HOME rather than deleting irreversibly", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "smartclaws-cli-test-"));
        mkdirSync(join(tempDir, "wallets"), { recursive: true });
        writeFileSync(
            join(tempDir, "wallets", "default.json"),
            JSON.stringify({ address: "0xabc", privateKey: generatePrivateKey() }),
        );
        writeFileSync(join(tempDir, "config.json"), JSON.stringify({ version: 2 }));

        const result = await runCli(["init", "--yes", "--no-backup"], tempDir);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--no-backup cannot be used");
        // Nothing was touched.
        expect(JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8")).version).toBe(2);
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
