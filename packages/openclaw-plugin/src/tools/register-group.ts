import { registerGroupWithResult } from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig, resolvedHome } from "../plugin-config.js";
import { attachAfterConfirmedRegistration } from "./attach.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { requireNonEmptyName } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function registerGroupTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_register_group",
        label: "SmartClaws Register Group",
        description:
            "Register a device group on-chain with an explicit stable name. Waits for a successful receipt. If local attachment fails after confirmation, recover with smartclaws_attach using the returned address and txHash — do not retry registration. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            name: Type.String({ description: "Required stable group name. Never generated." }),
            skills: Type.Optional(Type.String({ description: "Optional skills string." })),
            attach: Type.Optional(
                Type.Boolean({
                    description: "Attach the group locally after confirmation (default true).",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const name = requireNonEmptyName(params.name);
            const { entity, txHash } = await registerGroupWithResult(
                cfg,
                wallet,
                name,
                params.skills ?? "",
                home,
            );
            throwIfAborted(context.signal);
            const shouldAttach = params.attach !== false;
            const attachment = shouldAttach
                ? await attachAfterConfirmedRegistration({
                      homeDir: home,
                      kind: "group",
                      address: entity.groupAddress,
                      txHash,
                  })
                : { attached: false as const, fingerprint: undefined };
            return jsonCompatible({
                status: "confirmed",
                txHash,
                group: {
                    name: entity.name,
                    address: entity.groupAddress,
                    owner: entity.owner ?? null,
                    skills: entity.skills ?? "",
                    deviceCount: entity.deviceCount ?? null,
                },
                attached: attachment.attached,
                fingerprint: attachment.fingerprint ?? null,
            });
        },
    });
}
