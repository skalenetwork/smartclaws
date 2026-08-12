import { useParams } from "react-router";
import type { Address } from "viem";
import { ChannelView } from "@/components/shared/channel-view";

export function ChannelDetailPage() {
    const { address } = useParams<{ address: string }>();

    // Compact: a channel viewed on its own is a message log. Auto-charting
    // fields like `offset` or `toggle_after` is noise — device telemetry charts
    // live on the device page, which uses the full variant.
    return (
        <div>
            <ChannelView address={address as Address} variant="compact" />
        </div>
    );
}
