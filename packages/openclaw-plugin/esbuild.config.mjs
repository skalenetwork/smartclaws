import { build } from "esbuild";
import { pathToFileURL } from "node:url";

export const nodeEsmBanner = `
import { createRequire as __smartclawsCreateRequire } from "node:module";
import { fileURLToPath as __smartclawsFileURLToPath } from "node:url";
import { dirname as __smartclawsDirname } from "node:path";
const require = __smartclawsCreateRequire(import.meta.url);
const __filename = __smartclawsFileURLToPath(import.meta.url);
const __dirname = __smartclawsDirname(__filename);
`;

export const nodeEsmBuildOptions = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["openclaw", "openclaw/*"],
    banner: { js: nodeEsmBanner },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await build({
        ...nodeEsmBuildOptions,
        entryPoints: ["src/index.ts"],
        outfile: "dist/index.js",
    });
}
