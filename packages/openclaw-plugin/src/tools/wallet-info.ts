import { getViewKeyStatus, getWalletInfo } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function walletInfoTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_wallet_info",
        label: "SmartClaws Wallet Info",
        description:
            "Return the configured SmartClaws wallet address, on-chain balance, and whether its registered public key is the one it can decrypt with. Use this to diagnose a failed disclosure instead of retrying blindly. For per-entity read access use smartclaws_access_check. Never returns the private key.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const info = await getWalletInfo(cfg, wallet);
            // Wallet-scoped and O(1). Reader status used to be gathered here too, which made
            // "what is my address and balance" walk every known entity; it moved to
            // smartclaws_access_check, where it can also name a single entity.
            const key = await getViewKeyStatus(cfg, wallet);

            return {
                ...info,
                publicKeyRegistered: key.registered,
                // The distinction that explains a disclosure that costs a fee and comes back
                // unreadable: registered, but not with the key this wallet holds.
                registeredKeyOpensDisclosures: key.registered ? key.matchesViewKey : false,
                usesSeparateViewKey: !key.usesSigningKey,
            };
        },
    });
}
