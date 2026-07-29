import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { ConfigSchema } from "./plugin-config.js";
import { smartClawsTools } from "./tools/index.js";

export default defineToolPlugin({
    id: "smartclaws",
    name: "SmartClaws",
    description: "Publish and read IoT telemetry on SKALE through SmartClaws.",
    configSchema: ConfigSchema,
    activation: { onStartup: true },
    tools: smartClawsTools,
});
