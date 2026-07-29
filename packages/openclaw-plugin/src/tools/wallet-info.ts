import { getWalletInfo } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function walletInfoTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_wallet_info",
        label: "SmartClaws Wallet Info",
        description:
            "Return the configured SmartClaws wallet address and on-chain balance. Read-only; never returns the private key.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            return await getWalletInfo(cfg, wallet);
        },
    });
}
