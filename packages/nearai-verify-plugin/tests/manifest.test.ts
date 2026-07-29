import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));

describe("openclaw.plugin.json / package.json consistency", () => {
    test("manifest identity matches the shipped provider", () => {
        expect(manifest.id).toBe("nearai-verify");
        expect(manifest.providers).toEqual(["nearai"]);
        expect(manifest.version).toBe(pkg.version);
    });

    test("credential detection metadata is declared without loading the runtime", () => {
        expect(pkg.openclaw.providers).toEqual(["nearai"]);
        expect(manifest.setup.providers[0].id).toBe("nearai");
        expect(manifest.setup.providers[0].envVars).toContain("NEAR_AI_API_KEY");
    });

    test("the entry point and publishing metadata are present", () => {
        expect(pkg.openclaw.extensions).toEqual(["./dist/index.js"]);
        expect(pkg.openclaw.compat?.pluginApi).toBeTruthy();
        expect(pkg.openclaw.build?.openclawVersion).toBeTruthy();
    });

    test("the runtime slash command alias is registered", () => {
        const alias = manifest.commandAliases?.find(
            (entry: { name: string }) => entry.name === "nearai-verify",
        );
        expect(alias?.kind).toBe("runtime-slash");
    });

    test("agent tool contracts are declared", () => {
        expect(manifest.contracts.tools).toEqual(["nearai_list_chat_ids", "nearai_verify"]);
    });

    test("configuration is locked to observation-only enforcement", () => {
        expect(manifest.configSchema.properties.enforcement.enum).toEqual(["observe"]);
    });
});
