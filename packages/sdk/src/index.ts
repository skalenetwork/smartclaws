// Provider-agnostic SmartClaws service layer. Consumed by the CLI and by
// per-provider plugins (OpenClaw, etc.). No CLI, OpenClaw, or presentation
// dependencies live here — keep it that way so any provider can reuse it.

// Convenience re-exports of core primitives
export type {
  AgentFile,
  Config,
  DeviceFile,
  GroupFile,
  SmartClawsMode,
  WalletFile,
} from "@smartclaws/core/types";
export * from "./agent.js";
export * from "./backup.js";
export * from "./client.js";
// Config / wallet / local records / contract clients
export * from "./config.js";
export * from "./contracts.js";
export * from "./device.js";
// Typed errors
export * from "./errors.js";
export * from "./group.js";
export * from "./services/channels.js";
export * from "./services/discovery.js";
// Services (typed params in, structured data out)
export * from "./services/wallet.js";
export * from "./wallet.js";
