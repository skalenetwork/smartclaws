import { keepPreviousData } from "@tanstack/react-query";
import { decode, type Envelope } from "@smartclaws/core/envelope";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Address, type Hex, hexToBytes } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export interface DecodedMessage {
  offset: bigint;
  envelope: Envelope | null;
  raw: string;
  error?: string;
}

export function useChannelMessages(channelAddress: Address, initialCount = 20) {
  const [count, setCount] = useState(initialCount);
  const contract = { address: channelAddress, abi: abis.channel, chainId: chain.id } as const;

  // Track previous address so we can keep data on refetch but clear on channel switch
  const prevAddressRef = useRef(channelAddress);
  const addressChanged = prevAddressRef.current !== channelAddress;
  prevAddressRef.current = channelAddress;

  // Keep previous data only when refetching the same channel (prevents flicker).
  // On channel switch, return undefined so stale data from the old channel is never shown.
  const keepDataOnRefetch = addressChanged ? undefined : keepPreviousData;

  const { data: stats, isLoading: isLoadingStats } = useReadContracts({
    contracts: [
      { ...contract, functionName: "getMessageCount" },
      { ...contract, functionName: "getLatestMessageOffset" },
      { ...contract, functionName: "getOldestMessageOffset" },
      { ...contract, functionName: "getMaxCapacityBytes" },
      { ...contract, functionName: "totalBytes" },
    ],
    query: { refetchInterval: 5_000, placeholderData: keepDataOnRefetch },
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

  const { data: rawMessages, isLoading: isLoadingMessages, isFetching: isFetchingMessages } = useReadContract({
    ...contract,
    functionName: "readMessages",
    args: fromOffset !== undefined ? [fromOffset, BigInt(readCount)] : undefined,
    query: {
      enabled: fromOffset !== undefined && readCount > 0,
      refetchInterval: 5_000,
      placeholderData: keepPreviousData,
    },
  });

  const messages: DecodedMessage[] = useMemo(() => {
    if (!rawMessages) return [];
    const [payloads, offsets] = rawMessages as [Hex[], bigint[]];
    return payloads
      .map((payload, i) => {
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
      })
      .reverse();
  }, [rawMessages]);

  const canLoadMore = messageCount !== undefined && messages.length < Number(messageCount);
  const loadingMoreRef = useRef(false);
  const isLoadingMore = loadingMoreRef.current && isFetchingMessages;

  useEffect(() => {
    if (!isFetchingMessages) loadingMoreRef.current = false;
  }, [isFetchingMessages]);

  const loadMore = useCallback(() => {
    loadingMoreRef.current = true;
    setCount((prev) => prev + initialCount);
  }, [initialCount]);

  return {
    messages,
    messageCount,
    latestOffset,
    oldestOffset,
    maxCapacity,
    totalBytes,
    isLoading: isLoadingStats || isLoadingMessages,
    isLoadingMore,
    canLoadMore,
    loadMore,
  };
}
