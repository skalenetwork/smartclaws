import { useMemo } from "react";
import { type AccountLabel, useAccessGraph } from "@/hooks/use-access-graph";

/**
 * What the registry graph knows about an address — most usefully, that a wallet is the
 * one an agent acts through. Shares the graph's queries, so many callers cost one fetch.
 */
export function useAccountLabel(address: string | undefined): AccountLabel | undefined {
    const { candidates } = useAccessGraph();
    return useMemo(() => {
        if (!address) return undefined;
        const key = address.toLowerCase();
        return candidates.find((candidate) => candidate.address.toLowerCase() === key);
    }, [address, candidates]);
}
