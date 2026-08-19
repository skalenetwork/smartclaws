import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
};
const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8")) as {
    version: string;
    contracts: { tools: string[] };
    toolMetadata: Record<string, { optional?: boolean }>;
    configSchema: { properties: Record<string, unknown> };
};

const NON_OPTIONAL = [
    "smartclaws_setup_status",
    "smartclaws_wallet_info",
    "smartclaws_list_local",
    "smartclaws_discover",
    "smartclaws_access_check",
    "smartclaws_read",
    "smartclaws_reader_list",
    "smartclaws_backup_list",
];

const OPTIONAL = [
    "smartclaws_initialize",
    "smartclaws_configure",
    "smartclaws_attach",
    "smartclaws_sync",
    "smartclaws_home_reset",
    "smartclaws_register_group",
    "smartclaws_register_device",
    "smartclaws_register_agent",
    "smartclaws_role_grant",
    "smartclaws_role_revoke",
    "smartclaws_view_key_generate",
    "smartclaws_view_key_rotate",
    "smartclaws_view_key_register",
    "smartclaws_view_key_forget",
    "smartclaws_view_key_remove",
    "smartclaws_reader_grant",
    "smartclaws_reader_revoke",
    "smartclaws_backup_create",
    "smartclaws_backup_clean",
    "smartclaws_backup_restore",
    "smartclaws_disclose",
    "smartclaws_publish",
    "smartclaws_notify",
];

describe("openclaw.plugin.json", () => {
    test("package and manifest versions match", () => {
        expect(manifest.version).toBe(pkg.version);
    });

    test("pins the complete tool catalog and optional metadata", () => {
        expect([...NON_OPTIONAL, ...OPTIONAL].sort()).toEqual([...manifest.contracts.tools].sort());
        expect(manifest.contracts.tools).toEqual([
            "smartclaws_setup_status",
            "smartclaws_initialize",
            "smartclaws_configure",
            "smartclaws_attach",
            "smartclaws_sync",
            "smartclaws_home_reset",
            "smartclaws_register_group",
            "smartclaws_register_device",
            "smartclaws_register_agent",
            "smartclaws_role_grant",
            "smartclaws_role_revoke",
            "smartclaws_view_key_generate",
            "smartclaws_view_key_rotate",
            "smartclaws_view_key_register",
            "smartclaws_view_key_forget",
            "smartclaws_view_key_remove",
            "smartclaws_wallet_info",
            "smartclaws_list_local",
            "smartclaws_discover",
            "smartclaws_access_check",
            "smartclaws_read",
            "smartclaws_reader_list",
            "smartclaws_reader_grant",
            "smartclaws_reader_revoke",
            "smartclaws_backup_list",
            "smartclaws_backup_create",
            "smartclaws_backup_clean",
            "smartclaws_backup_restore",
            "smartclaws_disclose",
            "smartclaws_publish",
            "smartclaws_notify",
        ]);
        for (const name of NON_OPTIONAL) {
            expect(manifest.toolMetadata[name]?.optional).not.toBe(true);
        }
        for (const name of OPTIONAL) {
            expect(manifest.toolMetadata[name]?.optional).toBe(true);
        }
        expect(Object.keys(manifest.configSchema.properties)).toEqual([
            "smartclawsHome",
            "network",
            "rpcUrl",
            "chainId",
            "registryAddress",
            "allowPrivateRpc",
            "maxDiscoveryPageSize",
            "maxSyncEntities",
            "maxReadMessages",
            "maxChannelCapacityBytes",
        ]);
    });
});
