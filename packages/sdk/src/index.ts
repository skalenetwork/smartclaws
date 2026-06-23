// Provider-agnostic SmartClaws service layer. Consumed by the CLI and by
// per-provider plugins (OpenClaw, etc.). No CLI, OpenClaw, or presentation
// dependencies live here — keep it that way so any provider can reuse it.

// Config / wallet / local records / contract clients
export * from "./config.js";
export * from "./wallet.js";
export * from "./device.js";
export * from "./agent.js";
export * from "./contracts.js";
export * from "./client.js";

// Typed errors
export * from "./errors.js";

// Services (typed params in, structured data out)
export * from "./services/wallet.js";
export * from "./services/channels.js";

// Convenience re-exports of core primitives
export type { AgentFile, Config, DeviceFile, WalletFile } from "@smartclaws/core/types";
