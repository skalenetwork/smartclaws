import { useParams } from "react-router";
import type { Address } from "viem";
import { ChannelView } from "@/components/shared/channel-view";

export function ChannelDetailPage() {
    const { address } = useParams<{ address: string }>();

    return (
        <div>
            <ChannelView address={address as Address} />
        </div>
    );
}
