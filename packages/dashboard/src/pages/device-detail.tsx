import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  ChevronsDown,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Address } from "viem";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { ChannelView } from "@/components/shared/channel-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChannelMessages } from "@/hooks/use-channel-messages";
import { useDeviceDetail } from "@/hooks/use-device-detail";
import { getExplorerAddressUrl } from "@/lib/explorer";

export function DeviceDetailPage() {
  const { address } = useParams<{ address: string }>();

  // Key forces full remount when navigating between devices
  return <DeviceDetailContent key={address} address={address!} />;
}

function DeviceDetailContent({ address }: { address: string }) {
  const { incomingChannel, outgoingChannel, publisher, group, isLoading } = useDeviceDetail(
    address as Address,
  );
  const [activeTab, setActiveTab] = useState("outgoing");

  const activeChannel =
    activeTab === "outgoing" ? outgoingChannel : incomingChannel;

  const channelData = useChannelMessages(activeChannel ?? ("0x" as Address));

  // Also fetch 1 message from outgoing to get device name
  const { messages: nameMessages } = useChannelMessages(
    outgoingChannel ?? ("0x" as Address),
    1,
  );
  const devName = nameMessages[0]?.envelope?.dev;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const publisherExplorerUrl = publisher ? getExplorerAddressUrl(publisher) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {group && (
          <Link
            to={`/groups/${group}`}
            className="flex items-center justify-center h-7 w-7 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground transition-colors shrink-0"
            title="Back to group"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        )}
        <AddressAvatar address={address!} size={36} kind="device" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{devName || "Device"}</h1>
            <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Device</Badge>
          </div>
          <p className="text-muted-foreground/80 text-xs truncate">{address}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {publisherExplorerUrl && (
            <a
              href={publisherExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted rounded-full px-3.5 py-2 text-xs text-muted-foreground transition-colors"
            >
              View in Explorer
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="outgoing">
              <ArrowUpRight className="h-4 w-4" />
              Outgoing Channel
            </TabsTrigger>
            <TabsTrigger value="incoming">
              <ArrowDownLeft className="h-4 w-4" />
              Incoming Channel
            </TabsTrigger>
          </TabsList>

          {activeChannel && channelData.messageCount !== undefined && (
            <div className="bg-card inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="text-foreground font-medium">
                  {channelData.messages.length}
                </span>
                {" / "}
                <span className="text-foreground font-medium">
                  {channelData.messageCount.toString()}
                </span>
              </span>
              {channelData.hasMore && (
                <button
                  type="button"
                  onClick={() => channelData.loadMore()}
                  disabled={channelData.isLoadingMore}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent/80 disabled:opacity-50"
                >
                  {channelData.isLoadingMore ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronsDown className="h-3 w-3" />
                  )}
                  Load more
                </button>
              )}
            </div>
          )}
        </div>

        <TabsContent value="outgoing">
          {outgoingChannel ? (
            <ChannelView
              address={outgoingChannel}
              data={activeTab === "outgoing" ? channelData : undefined}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No outgoing channel configured
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="incoming">
          {incomingChannel ? (
            <ChannelView
              address={incomingChannel}
              data={activeTab === "incoming" ? channelData : undefined}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No incoming channel configured
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
