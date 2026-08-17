import {
    getAgentReaderStatus,
    getDeviceReaderStatus,
    getWalletInfo,
    hasPublicKeyWithConfig,
    listAgents,
    listDevices,
} from "@smartclaws/sdk";
import { Type } from "typebox";
import { requireWallet, resolveConfig } from "../plugin-config.js";
import type { SmartClawsToolFactory } from "./types.js";

export function walletInfoTool(tool: SmartClawsToolFactory) {
    return tool({
        name: "smartclaws_wallet_info",
        label: "SmartClaws Wallet Info",
        description:
            "Return the configured SmartClaws wallet address, on-chain balance, public-key registration, and reader status for locally known encrypted channels. Use this to diagnose a failed disclosure instead of retrying blindly. Never returns the private key.",
        parameters: Type.Object({}),
        execute: async (_params, config, context) => {
            context.signal?.throwIfAborted();
            const cfg = resolveConfig(config);
            const wallet = requireWallet(config.smartclawsHome);
            const info = await getWalletInfo(cfg, wallet);
            const publicKeyRegistered = await hasPublicKeyWithConfig(
                cfg,
                wallet.address as `0x${string}`,
            );

            const home = config.smartclawsHome;
            const readers = [];
            for (const device of listDevices(home)) {
                if (device.encrypted !== true) continue;
                const status = await getDeviceReaderStatus(
                    cfg,
                    device.deviceContract,
                    wallet.address,
                    home,
                );
                readers.push({
                    kind: "device" as const,
                    name: device.name,
                    incomingChannel: device.incomingChannel,
                    outgoingChannel: device.outgoingChannel,
                    isIncomingReader: status.isIncomingReader,
                    isOutgoingReader: status.isOutgoingReader,
                });
            }
            for (const agent of listAgents(home)) {
                if (agent.encrypted !== true) continue;
                const status = await getAgentReaderStatus(
                    cfg,
                    agent.agentContract,
                    wallet.address,
                    home,
                );
                readers.push({
                    kind: "agent" as const,
                    name: agent.name,
                    incomingChannel: agent.incomingChannel,
                    outgoingChannel: agent.outgoingChannel,
                    isIncomingReader: status.isIncomingReader,
                    isOutgoingReader: status.isOutgoingReader,
                });
            }

            return { ...info, publicKeyRegistered, readers };
        },
    });
}
