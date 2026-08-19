import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { nodeEsmBuildOptions } from "../../esbuild.config.mjs";

test("Node ESM bundle initializes the BITE encryption runtime", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "smartclaws-bundle-"));
    const outfile = join(tempDir, "encryption-probe.mjs");

    try {
        await build({
            ...nodeEsmBuildOptions,
            stdin: {
                contents: `
                    import { BITEMockup } from "@skalenetwork/bite";
                    const ciphertext = await new BITEMockup().encryptMessage("0x1234");
                    if (typeof ciphertext !== "string" || ciphertext.length === 0) {
                        throw new Error("encryption probe returned no ciphertext");
                    }
                `,
                loader: "js",
                resolveDir: join(process.cwd(), "../sdk/src"),
                sourcefile: "encryption-probe.mjs",
            },
            outfile,
        });

        expect(() => execFileSync("node", [outfile], { stdio: "pipe" })).not.toThrow();
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});
