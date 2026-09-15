import { useQueries } from "@tanstack/react-query";
import type { Address } from "viem";
import { chain, explorerUrl } from "@/config/wagmi";
import { fetchExplorer } from "@/lib/explorer-api";

interface AddressCounters {
    transactions_count: string;
    gas_usage_count: string;
}

/**
 * All-time transaction and gas totals for a set of contracts, summed from the explorer's
 * per-address counters. One request per address, refreshed every few minutes: the counters
 * move slowly and the explorer is a shared service.
 */
export function useExplorerTotals(addresses: Address[]) {
    return useQueries({
        queries: addresses.map((address) => ({
            queryKey: ["explorer-counters", chain.id, address.toLowerCase()],
            queryFn: () => fetchExplorer<AddressCounters>(`/addresses/${address}/counters`),
            enabled: !!explorerUrl,
            staleTime: 60_000,
            refetchInterval: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
        })),
        combine: (results) => {
            let transactions = 0n;
            let gasUsed = 0n;
            for (const result of results) {
                if (!result.data) continue;
                transactions += BigInt(result.data.transactions_count || "0");
                gasUsed += BigInt(result.data.gas_usage_count || "0");
            }
            return {
                transactions,
                gasUsed,
                isLoading: results.some((result) => result.isLoading),
                /** False when some counters failed, so the total is a lower bound. */
                complete: results.length > 0 && results.every((result) => result.isSuccess),
            };
        },
    });
}
