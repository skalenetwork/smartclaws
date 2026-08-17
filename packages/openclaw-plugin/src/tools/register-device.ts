import {
    loadConfig,
    registerDeviceWithResult,
    resolveGroup,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import {
    maxChannelCapacityBytes,
    requireWallet,
    resolveConfig,
    resolvedHome,
} from "../plugin-config.js";
import { attachAfterConfirmedRegistration } from "./attach.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { parseChannelCapacity, requireNonEmptyName } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function registerDeviceTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_register_device",
        label: "SmartClaws Register Device",
        description:
            "Register a device in a group. Capacity is a decimal string. Verifies the group before signing and waits for a successful receipt. If local attachment fails after confirmation, recover with smartclaws_attach — do not retry registration. No automatic retries.",
        optional: true,
        parameters: Type.Object({
            name: Type.String({ description: "Required stable device name." }),
            group: Type.Optional(
                Type.String({
                    description: "Group address or name. Defaults to the attached group.",
                }),
            ),
            capacityBytes: Type.Optional(
                Type.String({
                    description: "Channel capacity as a decimal string (default 1048576).",
                }),
            ),
            encrypted: Type.Optional(
                Type.Boolean({ description: "Register an encrypted device." }),
            ),
            attach: Type.Optional(
                Type.Boolean({
                    description: "Attach the device locally after confirmation (default true).",
                }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const home = resolvedHome(config);
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config);
            const name = requireNonEmptyName(params.name);
            const capacity = parseChannelCapacity(
                params.capacityBytes,
                maxChannelCapacityBytes(config),
            );
            const groupQuery = params.group || loadConfig(home)?.attachedGroupAddress;
            if (!groupQuery) {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "Device registration requires a group (parameter or attached group).",
                );
            }
            const group = await resolveGroup(groupQuery, cfg, wallet, home);
            throwIfAborted(context.signal);
            const { entity, txHash } = await registerDeviceWithResult(
                cfg,
                wallet,
                group.groupAddress,
                name,
                capacity,
                home,
                { encrypted: Boolean(params.encrypted) },
            );
            throwIfAborted(context.signal);
            const shouldAttach = params.attach !== false;
            const attachment = shouldAttach
                ? await attachAfterConfirmedRegistration({
                      homeDir: home,
                      kind: "device",
                      address: entity.deviceContract,
                      txHash,
                  })
                : { attached: false as const, fingerprint: undefined };
            return jsonCompatible({
                status: "confirmed",
                txHash,
                device: {
                    name: entity.name,
                    address: entity.deviceContract,
                    group: entity.groupAddress,
                    incomingChannel: entity.incomingChannel,
                    outgoingChannel: entity.outgoingChannel,
                    encrypted: entity.encrypted === true,
                },
                attached: attachment.attached,
                fingerprint: attachment.fingerprint ?? null,
            });
        },
    });
}
