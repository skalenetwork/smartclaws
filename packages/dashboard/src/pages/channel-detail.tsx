import { useParams } from "react-router";
import type { Address } from "viem";
import { AddressBadge } from "@/components/shared/address-badge";
import { ChannelView } from "@/components/shared/channel-view";
import { PageHeader } from "@/components/shared/page-header";

export function ChannelDetailPage() {
  const { address } = useParams<{ address: string }>();

  return (
    <div>
      <PageHeader title="Channel">
        <AddressBadge address={address!} kind="channel" />
      </PageHeader>
      <ChannelView address={address as Address} />
    </div>
  );
}
