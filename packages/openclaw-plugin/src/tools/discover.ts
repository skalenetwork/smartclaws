import {
    discoverAgentsPage,
    discoverDevicesPage,
    discoverGroupsPage,
    SmartClawsError,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import {
    discoveryPageLimit,
    requireWallet,
    resolveConfig,
    resolvedHome,
} from "../plugin-config.js";
import { throwIfAborted } from "./guards.js";
import { jsonCompatible } from "./result.js";
import { requireSafeInteger } from "./schemas.js";
import type { SmartClawsToolFactory } from "./types.js";

export function discoverTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_discover",
        label: "SmartClaws Discover",
        description:
            "Paginated on-chain discovery of groups, devices, or agents. Group and device pages cache lightweight summaries; channel and permission details hydrate on first use. Prefer addresses for exact resolution. `owned` is valid only for agents and requires a wallet.",
        parameters: Type.Object({
            kind: Type.Union(
                [Type.Literal("group"), Type.Literal("device"), Type.Literal("agent")],
                {
                    description: "Entity kind to discover.",
                },
            ),
            group: Type.Optional(
                Type.String({
                    description: "Group address or name. Required when kind is device.",
                }),
            ),
            owned: Type.Optional(
                Type.Boolean({
                    description:
                        "If true, return only agents owned by this wallet. Agent kind only.",
                }),
            ),
            offset: Type.Optional(Type.Number({ description: "Page offset (default 0)." })),
            limit: Type.Optional(
                Type.Number({ description: "Page size (default and hard-capped)." }),
            ),
        }),
        execute: async (params, config, context) => {
            throwIfAborted(context.signal);
            const offset = requireSafeInteger(params.offset, "offset", { min: 0 }) ?? 0;
            const cfg = resolveConfig(config);
            const home = resolvedHome(config);
            const limit = discoveryPageLimit(config, params.limit);
            if (params.owned && params.kind !== "agent") {
                throw new SmartClawsError(
                    "INVALID_TARGET",
                    "`owned` is only valid when discovering agents.",
                    { kind: params.kind },
                );
            }
            if (params.kind === "device" && !params.group) {
                throw new SmartClawsError("INVALID_TARGET", "Device discovery requires `group`.");
            }

            const wallet = params.owned ? requireWallet(config) : undefined;
            const page =
                params.kind === "group"
                    ? await discoverGroupsPage(cfg, { offset, limit, wallet, homeDir: home })
                    : params.kind === "device"
                      ? await discoverDevicesPage(cfg, params.group as string, {
                            offset,
                            limit,
                            wallet,
                            homeDir: home,
                        })
                      : await discoverAgentsPage(cfg, {
                            offset,
                            limit,
                            wallet,
                            homeDir: home,
                            owned: Boolean(params.owned),
                        });
            throwIfAborted(context.signal);
            return jsonCompatible({
                kind: params.kind,
                total: page.total,
                offset: page.offset,
                limit: page.limit,
                nextOffset: page.nextOffset,
                items: page.items.map((item) => {
                    if ("groupAddress" in item && "deviceCount" in item) {
                        return {
                            name: item.name,
                            address: item.groupAddress,
                            owner: item.owner ?? null,
                            skills: item.skills ?? "",
                            deviceCount: item.deviceCount,
                            hydration: item.hydration ?? (item.devices ? "full" : "summary"),
                            capabilities: item.capabilities ?? null,
                        };
                    }
                    if ("deviceContract" in item) {
                        return {
                            name: item.name,
                            address: item.deviceContract,
                            group: item.groupAddress,
                            incomingChannel: item.incomingChannel ?? null,
                            outgoingChannel: item.outgoingChannel ?? null,
                            encrypted: item.encrypted === true,
                            hydration:
                                item.hydration ??
                                (item.incomingChannel && item.outgoingChannel ? "full" : "summary"),
                            capabilities: item.capabilities ?? null,
                        };
                    }
                    return {
                        name: item.name,
                        address: item.agentContract,
                        owner: item.owner ?? null,
                        incomingChannel: item.incomingChannel,
                        outgoingChannel: item.outgoingChannel,
                        encrypted: item.encrypted === true,
                        capabilities: item.capabilities ?? null,
                    };
                }),
            });
        },
    });
}
