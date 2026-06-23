import type { DefineToolPluginOptions } from "openclaw/plugin-sdk/tool-plugin";
import { ConfigSchema } from "../plugin-config.js";

type SmartClawsToolsCallback = DefineToolPluginOptions<typeof ConfigSchema>["tools"];

export type SmartClawsToolFactory = Parameters<SmartClawsToolsCallback>[0];
