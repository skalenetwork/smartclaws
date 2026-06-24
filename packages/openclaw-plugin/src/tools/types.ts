import type { DefineToolPluginOptions } from "openclaw/plugin-sdk/tool-plugin";
import type { ConfigSchema } from "../plugin-config.js";

type SmartClawsToolsCallback = DefineToolPluginOptions<typeof ConfigSchema>["tools"];

export type SmartClawsToolFactory = Parameters<SmartClawsToolsCallback>[0];
