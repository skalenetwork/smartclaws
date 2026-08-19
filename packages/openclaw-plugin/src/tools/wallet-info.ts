import { getViewKeyStatus, getWalletInfo } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import type { SmartClawsToolFactory } from "./types.js";

export function walletInfoTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_wallet_info",
        label: "SmartClaws Wallet Info",
        description:
            "Return the configured SmartClaws wallet address, on-chain balance, chain/network, and whether its registered public key is the one it can decrypt with. Use this to diagnose a failed disclosure instead of retrying blindly. For per-entity read access use smartclaws_access_check. Never returns the private key.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            throwIfAborted(context.signal);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const info = await getWalletInfo(cfg, wallet);
            const key = wallet.viewPrivateKey ? await getViewKeyStatus(cfg, wallet) : null;
            throwIfAborted(context.signal);

            return jsonCompatible({
                ...info,
                network: cfg.network,
                chainId: cfg.chainId,
                publicKeyRegistered: key?.registered ?? null,
                registeredKeyOpensDisclosures: key
                    ? key.registered
                        ? key.matchesViewKey
                        : false
                    : null,
                usesSeparateViewKey: key ? !key.viewKeyMissing : null,
            });
        },
    });
}
