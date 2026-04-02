import { decode, type Envelope } from "@smartclaws/core/envelope";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address, type Hex, hexToBytes } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export interface DecodedMessage {
  offset: bigint;
  envelope: Envelope | null;
  raw: string;
  error?: string;
}

function decodePayloads(payloads: Hex[], offsets: bigint[]): DecodedMessage[] {
  return payloads.map((payload, i) => {
    const bytes = hexToBytes(payload);
    try {
      const envelope = decode(bytes);
      return { offset: offsets[i], envelope, raw: payload };
    } catch (e) {
      return {
        offset: offsets[i],
        envelope: null,
        raw: payload,
        error: e instanceof Error ? e.message : "decode error",
      };
    }
  });
}

export function useChannelMessages(channelAddress: Address, count = 20) {
  const contract = { address: channelAddress, abi: abis.channel, chainId: chain.id } as const;
  const publicClient = usePublicClient({ chainId: chain.id });

  const { data: stats, isLoading: isLoadingStats } = useReadContracts({
    contracts: [
      { ...contract, functionName: "getMessageCount" },
      { ...contract, functionName: "getLatestMessageOffset" },
      { ...contract, functionName: "getOldestMessageOffset" },
      { ...contract, functionName: "getMaxCapacityBytes" },
      { ...contract, functionName: "totalBytes" },
    ],
    query: { refetchInterval: 5_000 },
  });

  const messageCount = stats?.[0]?.result as bigint | undefined;
  const latestOffset = stats?.[1]?.result as bigint | undefined;
  const oldestOffset = stats?.[2]?.result as bigint | undefined;
  const maxCapacity = stats?.[3]?.result as bigint | undefined;
  const totalBytes = stats?.[4]?.result as bigint | undefined;

  const fromOffset = useMemo(() => {
    if (latestOffset === undefined || messageCount === undefined || messageCount === 0n)
      return undefined;
    const start = latestOffset - BigInt(Math.min(count - 1, Number(messageCount) - 1));
    return start < (oldestOffset ?? 0n) ? oldestOffset : start;
  }, [latestOffset, messageCount, oldestOffset, count]);

  const readCount = useMemo(() => {
    if (fromOffset === undefined || latestOffset === undefined) return 0;
    return Number(latestOffset - fromOffset) + 1;
  }, [fromOffset, latestOffset]);

  const { data: rawMessages, isLoading: isLoadingMessages } = useReadContract({
    ...contract,
    functionName: "readMessages",
    args: fromOffset !== undefined ? [fromOffset, BigInt(readCount)] : undefined,
    query: {
      enabled: fromOffset !== undefined && readCount > 0,
      refetchInterval: 5_000,
    },
  });

  const headMessages = useMemo(() => {
    if (!rawMessages) return [];
    const [payloads, offsets] = rawMessages as [Hex[], bigint[]];
    return decodePayloads(payloads, offsets);
  }, [rawMessages]);

  const [olderMessages, setOlderMessages] = useState<DecodedMessage[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    setOlderMessages([]);
  }, [channelAddress]);

  const oldestLoadedOffset = useMemo(() => {
    const all = [...headMessages, ...olderMessages];
    if (all.length === 0) return undefined;
    return all.reduce((min, m) => (m.offset < min ? m.offset : min), all[0].offset);
  }, [headMessages, olderMessages]);

  const hasMore =
    oldestLoadedOffset !== undefined &&
    oldestOffset !== undefined &&
    oldestLoadedOffset > oldestOffset;

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || oldestLoadedOffset === undefined || oldestOffset === undefined)
      return;
    setIsLoadingMore(true);
    try {
      const batchEnd = oldestLoadedOffset - 1n;
      const batchStart =
        batchEnd - BigInt(count) + 1n < oldestOffset
          ? oldestOffset
          : batchEnd - BigInt(count) + 1n;
      const batchCount = Number(batchEnd - batchStart) + 1;
      if (batchCount <= 0) return;

      const result = await publicClient!.readContract({
        address: channelAddress,
        abi: abis.channel,
        functionName: "readMessages",
        args: [batchStart, BigInt(batchCount)],
      });
      const [payloads, offsets] = result as unknown as [Hex[], bigint[]];
      setOlderMessages((prev) => [...prev, ...decodePayloads(payloads, offsets)]);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, oldestLoadedOffset, oldestOffset, count, channelAddress]);

  const messages = useMemo(() => {
    const all = [...headMessages, ...olderMessages];
    const seen = new Set<string>();
    const unique = all.filter((m) => {
      const key = m.offset.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => (b.offset > a.offset ? 1 : b.offset < a.offset ? -1 : 0));
    return unique;
  }, [headMessages, olderMessages]);

  return {
    messages,
    messageCount,
    latestOffset,
    oldestOffset,
    maxCapacity,
    totalBytes,
    isLoading: isLoadingStats || isLoadingMessages,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}
