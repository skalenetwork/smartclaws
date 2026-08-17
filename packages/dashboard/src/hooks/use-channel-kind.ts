import { useQueries, useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export type ChannelKind = "plain" | "encrypted";

const channelKindCache = new Map<string, ChannelKind>();

export async function resolveChannelKind(
    client: PublicClient,
    address: Address,
): Promise<ChannelKind> {
    const key = address.toLowerCase();
    const cached = channelKindCache.get(key);
    if (cached) return cached;

    const encrypted = await client.readContract({
        address,
        abi: abis.channel,
        functionName: "isEncrypted",
    });
    const kind = encrypted ? "encrypted" : "plain";
    channelKindCache.set(key, kind);
    return kind;
}

export function rememberChannelKind(address: Address, kind: ChannelKind): void {
    channelKindCache.set(address.toLowerCase(), kind);
}

export function useChannelKind(address: Address | undefined, knownKind?: ChannelKind) {
    const client = usePublicClient({ chainId: chain.id });

    if (address && knownKind) rememberChannelKind(address, knownKind);

    const query = useQuery({
        queryKey: ["channel-kind", chain.id, address?.toLowerCase()],
        queryFn: () => {
            if (!client || !address) throw new Error("Channel kind query is not ready");
            return resolveChannelKind(client, address);
        },
        enabled: !!address && !!client && !knownKind,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        initialData: address
            ? (knownKind ?? channelKindCache.get(address.toLowerCase()))
            : undefined,
    });

    return {
        kind: knownKind ?? query.data,
        isEncrypted: (knownKind ?? query.data) === "encrypted",
        isLoading: !knownKind && query.isLoading,
    };
}

export function useChannelKinds(addresses: (Address | undefined)[]) {
    const client = usePublicClient({ chainId: chain.id });
    const queries = useQueries({
        queries: addresses.map((address) => ({
            queryKey: ["channel-kind", chain.id, address?.toLowerCase()],
            queryFn: () => {
                if (!client || !address) throw new Error("Channel kind query is not ready");
                return resolveChannelKind(client, address);
            },
            enabled: !!address && !!client,
            staleTime: Number.POSITIVE_INFINITY,
            gcTime: Number.POSITIVE_INFINITY,
            initialData: address ? channelKindCache.get(address.toLowerCase()) : undefined,
        })),
    });

    return {
        kinds: queries.map((query) => query.data),
        isLoading: queries.some((query) => query.isLoading),
    };
}
