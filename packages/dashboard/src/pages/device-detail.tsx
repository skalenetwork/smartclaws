import { ArrowDownLeft, ArrowLeft, ArrowUpRight, KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { Address } from "viem";
import { AccessPanel } from "@/components/shared/access-panel";
import { AddressAvatar } from "@/components/shared/address-avatar";
import { ChannelAddressBar } from "@/components/shared/channel-address-bar";
import { ChannelView } from "@/components/shared/channel-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChannelKind } from "@/hooks/use-channel-kind";
import { useChannelMessages } from "@/hooks/use-channel-messages";
import { useDeviceDetail } from "@/hooks/use-device-detail";

export function DeviceDetailPage() {
    const { address } = useParams<{ address: string }>();
    const location = useLocation();
    if (!address) return null;

    const channelKind = (location.state as { channelKind?: ChannelKind } | null)?.channelKind;

    // Key forces full remount when navigating between devices
    return <DeviceDetailContent key={address} address={address} knownKind={channelKind} />;
}

function DeviceDetailContent({ address, knownKind }: { address: string; knownKind?: ChannelKind }) {
    const { incomingChannel, outgoingChannel, channelKind, deviceId, group, isLoading } =
        useDeviceDetail(address as Address, knownKind);
    const [activeTab, setActiveTab] = useState("outgoing");

    // `access` is not a channel tab, so no address bar is shown for it.
    const activeChannel =
        activeTab === "outgoing"
            ? outgoingChannel
            : activeTab === "incoming"
              ? incomingChannel
              : undefined;

    // Fetch 1 message from outgoing to get device name
    const { messages: nameMessages } = useChannelMessages(outgoingChannel, 1, channelKind);
    const devName = deviceId ?? nameMessages[0]?.envelope?.dev;

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

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
                <AddressAvatar address={address} size={36} kind="device" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-semibold">{devName || "Device"}</h1>
                        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                            Device
                        </Badge>
                    </div>
                    <p className="text-muted-foreground/80 text-xs truncate">{address}</p>
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
                        <TabsTrigger value="access">
                            <KeyRound className="h-4 w-4" />
                            Access
                        </TabsTrigger>
                    </TabsList>
                </div>

                {activeChannel && <ChannelAddressBar address={activeChannel} />}

                <TabsContent value="outgoing">
                    {outgoingChannel ? (
                        <ChannelView address={outgoingChannel} channelKind={channelKind} />
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
                        <ChannelView address={incomingChannel} channelKind={channelKind} />
                    ) : (
                        <Card>
                            <CardContent className="py-12 text-center text-sm text-muted-foreground">
                                No incoming channel configured
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="access">
                    <AccessPanel
                        subject={address as Address}
                        kind="device"
                        channelKind={channelKind}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
