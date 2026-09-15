import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useAccessGraph } from "@/hooks/use-access-graph";
import type { ChannelInfo } from "@/hooks/use-channel-directory";

/** Who a message is credited to. */
export interface Sender {
    key: string;
    name: string;
    /**
     * `true`: the wallet owns a registered agent contract. `false`: a writing wallet no agent
     * contract points to — an unregistered agent. `null`: several writers, or none on record.
     */
    registered: boolean | null;
    wallet?: Address;
}

/** A wallet with a write role on some channel but no agent contract of its own. */
export interface UnregisteredAgent {
    wallet: Address;
    /** "Unregistered 1", "Unregistered 2", … */
    name: string;
    channels: ChannelInfo[];
}

export type SenderLabels = ReturnType<typeof useSenders>;

const short = (address: Address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Credits traffic to agents. Devices never transact; an agent's wallet does, whether or not
 * that agent registered a contract. A channel's messages go to the one wallet holding its
 * write role; with several holders they are credited to the group, since the role alone
 * cannot say which of them sent a given message.
 */
export function useSenders(channels: ChannelInfo[]) {
    const { candidates } = useAccessGraph();
    const { address: viewer } = useAccount();

    return useMemo(() => {
        const known = new Map(
            candidates.map((candidate) => [candidate.address.toLowerCase(), candidate]),
        );
        const viewerKey = viewer?.toLowerCase();
        const isRegistered = (key: string) => known.get(key)?.kind === "agent-owner";

        // Numbered in directory order — devices, then agents; outgoing before incoming — so a
        // label holds across reloads and filters and only moves if the roles themselves do.
        // The connected wallet is numbered too, so connecting never renumbers anyone else.
        const unregistered = new Map<string, UnregisteredAgent>();
        for (const info of channels) {
            for (const writer of info.writers ?? []) {
                const key = writer.toLowerCase();
                if (isRegistered(key)) continue;
                let agent = unregistered.get(key);
                if (!agent) {
                    agent = {
                        wallet: writer,
                        name: `Unregistered ${unregistered.size + 1}`,
                        channels: [],
                    };
                    unregistered.set(key, agent);
                }
                agent.channels.push(info);
            }
        }

        const wallet = (address: Address): Sender => {
            const key = address.toLowerCase();
            const label = known.get(key);
            // An agent acts through the wallet that owns its contract.
            if (label?.kind === "agent-owner") {
                return { key, name: label.name ?? label.label, registered: true, wallet: address };
            }
            return {
                key,
                name:
                    key === viewerKey
                        ? "You"
                        : (unregistered.get(key)?.name ?? `Unregistered agent ${short(address)}`),
                registered: false,
                wallet: address,
            };
        };

        const channel = (info: ChannelInfo | undefined): Sender => {
            if (!info?.writers) return { key: "unknown", name: "Unknown sender", registered: null };
            const count = info.writerCount ?? info.writers.length;
            if (count === 1 && info.writers[0]) return wallet(info.writers[0]);
            const key = info.address.toLowerCase();
            if (count === 0) {
                return {
                    key: `none:${key}`,
                    name: `${info.subject.name} (no writer on record)`,
                    registered: null,
                };
            }
            return {
                key: `many:${key}`,
                name: `${info.subject.name} publishers (${count})`,
                registered: null,
            };
        };

        return { wallet, channel, unregistered: [...unregistered.values()] };
    }, [candidates, viewer, channels]);
}
