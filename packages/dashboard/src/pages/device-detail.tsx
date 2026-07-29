import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, Copy, ExternalLink } from "lucide-react";
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

function ChannelAddressBar({ address }: { address: string }) {
    const [copied, setCopied] = useState(false);
    const explorerUrl = getExplorerAddressUrl(address);

    function handleCopy() {
        navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
            <AddressAvatar address={address} size={16} kind="channel" />
            <code className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">
                {address}
            </code>
            <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                title="Copy address"
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {explorerUrl && (
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                    title="View in Explorer"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            )}
        </div>
    );
}

export function DeviceDetailPage() {
    const { address } = useParams<{ address: string }>();
    if (!address) return null;

    // Key forces full remount when navigating between devices
    return <DeviceDetailContent key={address} address={address} />;
}

function DeviceDetailContent({ address }: { address: string }) {
    const { incomingChannel, outgoingChannel, deviceId, group, isLoading } = useDeviceDetail(
        address as Address,
    );
    const [activeTab, setActiveTab] = useState("outgoing");

    const activeChannel = activeTab === "outgoing" ? outgoingChannel : incomingChannel;

    // Fetch 1 message from outgoing to get device name
    const { messages: nameMessages } = useChannelMessages(outgoingChannel, 1);
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
                    </TabsList>
                </div>

                {activeChannel && <ChannelAddressBar address={activeChannel} />}

                <TabsContent value="outgoing">
                    {outgoingChannel ? (
                        <ChannelView address={outgoingChannel} />
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
                        <ChannelView address={incomingChannel} />
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
