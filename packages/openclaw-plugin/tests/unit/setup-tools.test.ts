import { beforeEach, describe, expect, test } from "bun:test";
import {
    attachHomeEntities,
    CONFIG,
    initializeHome,
    resetHomeChecked,
    syncLocalCacheBounded,
    type ToolSpec,
    toolFactory,
    updateHomeConfig,
    WALLET,
} from "./sdk-mock.ts";

const HOME = "/tmp/smartclaws-test";

describe("smartclaws_initialize", () => {
    beforeEach(() => {
        initializeHome.mockClear();
    });

    test("is optional and generates a HOME without returning a private key", async () => {
        const { initializeTool } = await import("../../src/tools/initialize.ts");
        const spec = initializeTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_initialize");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { mode: "controller", network: "base-testnet" },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(initializeHome).toHaveBeenCalledWith({
            homeDir: HOME,
            mode: "controller",
            network: "base-testnet",
        });
        expect(result.status).toBe("initialized");
        expect(result.walletAddress).toBe(WALLET.address);
        expect(JSON.stringify(result)).not.toContain("privateKey");
        expect(JSON.stringify(result)).not.toContain(HOME);
    });
});

describe("smartclaws_configure", () => {
    test("patches HOME config with the expected fingerprint", async () => {
        const { configureTool } = await import("../../src/tools/configure.ts");
        const spec = configureTool(toolFactory as never) as ToolSpec;
        expect(spec.name).toBe("smartclaws_configure");
        expect(spec.optional).toBe(true);
        const result = (await spec.execute(
            { expectedFingerprint: "abc", rpcUrl: "http://127.0.0.1:8545", chainId: 31337 },
            { smartclawsHome: HOME, allowPrivateRpc: true },
            {},
        )) as Record<string, unknown>;
        expect(updateHomeConfig).toHaveBeenCalledWith({
            homeDir: HOME,
            expectedFingerprint: "abc",
            allowPrivateRpc: true,
            patch: {
                network: undefined,
                rpcUrl: "http://127.0.0.1:8545",
                chainId: 31337,
                registryAddress: undefined,
                mode: undefined,
            },
        });
        expect(result.status).toBe("updated");
        expect(result.fingerprint).toBe("cfg-fp");
        expect(result).toHaveProperty("shadowedFields");
    });
});

describe("smartclaws_attach", () => {
    test("forwards omitted vs null fields to the SDK", async () => {
        const { attachTool } = await import("../../src/tools/attach.ts");
        const spec = attachTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        await spec.execute(
            { expectedFingerprint: "abc", group: "home", agent: null },
            { smartclawsHome: HOME },
            {},
        );
        expect(attachHomeEntities).toHaveBeenCalledWith({
            homeDir: HOME,
            expectedFingerprint: "abc",
            group: "home",
            agent: null,
            devices: undefined,
        });
    });
});

describe("smartclaws_sync", () => {
    test("syncs through the bounded SDK helper and omits entity records", async () => {
        const { syncTool } = await import("../../src/tools/sync.ts");
        const spec = syncTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        const result = (await spec.execute({}, { smartclawsHome: HOME }, {})) as Record<
            string,
            unknown
        >;
        expect(syncLocalCacheBounded).toHaveBeenCalledWith(CONFIG, {
            wallet: WALLET,
            homeDir: HOME,
            maxEntities: 1000,
        });
        expect(result.status).toBe("synced");
        expect(result.complete).toBe(true);
        expect(result).not.toHaveProperty("groups");
        expect(result).not.toHaveProperty("devices");
        expect(result).not.toHaveProperty("agents");
    });
});

describe("smartclaws_home_reset", () => {
    test("refuses without confirm and returns a backup name, not a path", async () => {
        const { homeResetTool } = await import("../../src/tools/configure.ts");
        const spec = homeResetTool(toolFactory as never) as ToolSpec;
        expect(spec.optional).toBe(true);
        await expect(
            spec.execute(
                { expectedFingerprint: "abc", reason: "deployment-change", confirm: false },
                { smartclawsHome: HOME },
                {},
            ),
        ).rejects.toThrow(/confirm/);
        expect(resetHomeChecked).not.toHaveBeenCalled();

        const result = (await spec.execute(
            { expectedFingerprint: "abc", reason: "stale-config", confirm: true },
            { smartclawsHome: HOME },
            {},
        )) as Record<string, unknown>;
        expect(resetHomeChecked).toHaveBeenCalledWith({
            homeDir: HOME,
            expectedFingerprint: "abc",
            reason: "stale-config",
        });
        expect(result.status).toBe("reset");
        expect(result.backupName).toBe("backup-20260101-000000Z");
        expect(result).not.toHaveProperty("path");
        expect(JSON.stringify(result)).not.toContain(HOME);
    });
});
