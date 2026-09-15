import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router";

const TABS = ["outgoing", "incoming", "access"] as const;

/**
 * The device/agent detail tab, kept in `?tab=` so a link can open a specific channel —
 * the overview's activity rows land on the channel the event happened in.
 */
export function useTabParam(): [string, (tab: string) => void] {
    const [params, setParams] = useSearchParams();
    const location = useLocation();
    const requested = params.get("tab");
    const tab = TABS.includes(requested as (typeof TABS)[number])
        ? (requested as string)
        : "outgoing";

    const setTab = useCallback(
        (next: string) => {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    updated.set("tab", next);
                    return updated;
                },
                // Replace, so switching tabs does not fill the back stack; keep the router
                // state, which carries the channel kind the page was opened with.
                { replace: true, state: location.state },
            );
        },
        [setParams, location.state],
    );

    return [tab, setTab];
}
